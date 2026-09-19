import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MANIFEST_PATH,
  NEXUS_HOME,
  REPOS_DIR,
  OFFICIAL_SKILLS_DIR,
  repoDir,
} from '../../paths.js'
import { diagnoseEntry, findOrphanRepos, findOrphanLinks } from '../../health.js'
import type { OrphanLink } from '../../health.js'
import { isDetachedHead, lsRemoteCommit } from '../../git.js'
import type { Manifest, SkillEntry } from '../../types.js'

/**
 * `doctor [--json] [--updates] [--quiet]` — a proactive, read-only full checkup
 * of nexus state. Reports problems and how to fix them; changes nothing.
 *
 * Default is fully local and instant. `--updates` additionally compares each
 * branch-pinned entry against its remote (network). `--json` emits a stable
 * machine-readable contract (version 1) for external tools; `--quiet` suppresses
 * output unless there is at least one error (CI convenience).
 *
 * Exit codes: 0 = no error, 1 = at least one error, 2 = usage error.
 */

export type CheckStatus = 'ok' | 'warn' | 'error' | 'update-available'
export type Severity = 'error' | 'warn' | 'info'

export interface DoctorIssue {
  severity: Severity
  code: string
  name: string
  fix?: string
  detail?: string
}

export interface DoctorCheck {
  id: string
  status: CheckStatus
  detail?: string
  issues: DoctorIssue[]
}

export interface DoctorReport {
  version: 1
  checks: DoctorCheck[]
  summary: { errors: number; warnings: number; updates: number }
}

export interface DoctorOptions {
  json: boolean
  updates: boolean
  quiet: boolean
}

/* ------------------------------------------------------------------ */
/* Argument parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse `doctor` args. All three flags are boolean and reject an inline value
 * (same rule as `--yes` in args.ts): silently dropping `--json=false` would
 * turn it into `--json=true`. Positional arguments and unknown options are
 * usage errors — `doctor` always checks everything.
 */
export function parseDoctorArgs(argv: string[]): DoctorOptions {
  let json = false
  let updates = false
  let quiet = false

  for (const a of argv) {
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    if (flag === '--json' || flag === '--updates' || flag === '--quiet') {
      if (inlineVal !== undefined) {
        throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
      }
      if (flag === '--json') json = true
      else if (flag === '--updates') updates = true
      else quiet = true
    } else if (!a.startsWith('-')) {
      throw new Error(`doctor takes no positional arguments (got "${a}")`)
    } else {
      throw new Error(`unknown option: ${a}`)
    }
  }

  return { json, updates, quiet }
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/**
 * Run every check and assemble the report. `includeUpdates` adds the network
 * `updates` check (P2). Order matches the human-readable report.
 */
export async function runChecks(includeUpdates: boolean): Promise<DoctorReport> {
  const { entries, trusted, check: manifestCheck } = await checkManifest()
  const checks: DoctorCheck[] = [manifestCheck, await checkRoots(), await checkSymlinks(entries)]
  // Orphan detection is FS-driven: with an unreadable manifest the entry set is
  // unknown, so EVERY clone/link would look orphaned and draw a dangerous
  // "remove it" hint. When the manifest is not trustworthy, skip these checks
  // rather than induce mass deletion. (A merely absent manifest IS trustworthy:
  // empty genuinely means nothing installed.)
  if (trusted) {
    checks.push(await checkOrphanRepos(entries), await checkOrphanLinks(entries))
  } else {
    checks.push(skippedOrphan('orphan-repo'), skippedOrphan('orphan-link'))
  }
  checks.push(await checkGitSanity(entries))
  if (includeUpdates) checks.push(await checkUpdates(entries))
  return { version: 1, checks, summary: summarize(checks) }
}

/**
 * A check that could not run because the manifest is unreadable. Carries a
 * single non-actionable `warn` issue (no `fix`, no delete hint) so the `warn`
 * label is reflected in the summary count and the JSON contract stays
 * consistent (every warn/error status has at least one issue of that severity).
 */
function skippedOrphan(id: string): DoctorCheck {
  const scan = id === 'orphan-repo' ? 'repos/' : 'skills/'
  return {
    id,
    status: 'warn',
    issues: [
      {
        severity: 'warn',
        code: 'orphan-check-skipped',
        name: scan,
        detail: 'manifest unreadable — ownership unknown, not scanned (no deletion advised)',
      },
    ],
  }
}

/**
 * Minimal structural guard so a malformed entry never reaches repoDir()/readlink().
 * Only SkillEntry's *required* string fields are checked (name/url/gitUrl/ref/
 * path/addedAt); `commit`/`subdir`/`updatedAt` are optional and `name`+`path`
 * are the ones dereferenced unsafely downstream.
 */
function isWellFormedEntry(e: unknown): e is SkillEntry {
  if (typeof e !== 'object' || e === null) return false
  const o = e as Record<string, unknown>
  return (
    isNonEmptyString(o.name) &&
    isNonEmptyString(o.url) &&
    isNonEmptyString(o.gitUrl) &&
    isNonEmptyString(o.ref) &&
    isNonEmptyString(o.path) &&
    isNonEmptyString(o.addedAt)
  )
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * `manifest` — distinguish a missing manifest (normal on a fresh install) from
 * a present-but-corrupt one (error). `readManifest()` collapses both into an
 * empty manifest, so doctor stats + parses the file itself. Also surfaces any
 * `manifest.json.corrupt-<ts>` backup that `readManifest()` left behind.
 */
async function checkManifest(): Promise<{ entries: SkillEntry[]; trusted: boolean; check: DoctorCheck }> {
  const issues: DoctorIssue[] = []
  let entries: SkillEntry[] = []
  let trusted = true
  let detail = 'no manifest yet (0 entries)'

  let present = true
  try {
    await stat(MANIFEST_PATH)
  } catch {
    present = false
  }

  if (present) {
    try {
      const raw = await readFile(MANIFEST_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Manifest
      if (
        parsed && parsed.version === 1 && Array.isArray(parsed.skills) &&
        parsed.skills.every(isWellFormedEntry)
      ) {
        entries = parsed.skills
        detail = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} (version 1)`
      } else {
        detail = 'manifest is malformed'
        issues.push(corruptManifestIssue())
      }
    } catch {
      detail = 'manifest is unreadable'
      issues.push(corruptManifestIssue())
    }
    // A present-but-unreadable manifest means entry ownership is unknown, so
    // downstream orphan checks must be suppressed (see runChecks).
    if (issues.some((i) => i.code === 'corrupt-manifest')) {
      trusted = false
      entries = []
    }
  }

  // Historical corruption backups: manifest.json.corrupt-<timestamp>
  try {
    for (const f of await readdir(NEXUS_HOME)) {
      if (f.includes('.corrupt-')) {
        issues.push({
          severity: 'warn',
          code: 'corrupt-backup',
          name: f,
          detail: 'a past manifest corruption was backed up here',
        })
      }
    }
  } catch {
    // NEXUS_HOME absent — nothing to scan
  }

  return { entries, trusted, check: finalize('manifest', detail, issues) }
}

function corruptManifestIssue(): DoctorIssue {
  return {
    severity: 'error',
    code: 'corrupt-manifest',
    name: 'manifest.json',
    fix: 'inspect ~/.dsh/skills-nexus/manifest.json; a .corrupt- backup (if any) holds the last raw content',
  }
}

/**
 * `roots` — a root that does not exist yet is normal (nothing installed); only a
 * permission failure on an existing directory is an error.
 */
async function checkRoots(): Promise<DoctorCheck> {
  const issues: DoctorIssue[] = []
  const readable: string[] = []
  const absent: string[] = []

  const roots: Array<[string, string]> = [
    ['repos/', REPOS_DIR],
    ['skills/', OFFICIAL_SKILLS_DIR],
  ]
  for (const [label, dir] of roots) {
    try {
      await readdir(dir)
      readable.push(label)
    } catch (err) {
      if (isNotFound(err)) absent.push(label)
      else {
        issues.push({
          severity: 'error',
          code: 'root-unreadable',
          name: label,
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  let detail = 'unreadable'
  if (issues.length === 0) {
    const parts: string[] = []
    if (readable.length > 0) parts.push(`${readable.join(' and ')} readable`)
    if (absent.length > 0) parts.push(`${absent.join(' and ')} not created yet`)
    detail = parts.length > 0 ? parts.join('; ') : 'ok'
  }
  return finalize('roots', detail, issues)
}

/** `symlinks` — per-entry diagnosis via health.diagnoseEntry(). */
async function checkSymlinks(entries: SkillEntry[]): Promise<DoctorCheck> {
  const issues: DoctorIssue[] = []
  let ok = 0
  let disabled = 0
  for (const e of entries) {
    const d = await diagnoseEntry(e)
    if (d === 'ok') ok++
    else if (d === 'disabled') disabled++
    else {
      issues.push({
        severity: 'error',
        code: 'missing-target',
        name: e.name,
        fix: `dsh-skills-nexus update ${e.name}`,
      })
    }
  }
  const detail =
    entries.length === 0
      ? 'no entries'
      : `${ok}/${entries.length} links ok${disabled > 0 ? `, ${disabled} disabled` : ''}`
  return finalize('symlinks', detail, issues)
}

/** `orphan-repo` — leftover clones under repos/ (warn). */
async function checkOrphanRepos(entries: SkillEntry[]): Promise<DoctorCheck> {
  const orphans = await findOrphanRepos(entries)
  const issues = orphans.map<DoctorIssue>((p) => ({
    severity: 'warn',
    code: 'orphan-repo',
    name: `repos/${p}`,
    fix: `remove the stale clone at repos/${p}, or re-add it as a skill`,
  }))
  return finalize('orphan-repo', issues.length === 0 ? 'none' : undefined, issues)
}

/** `orphan-link` — FS-side scan of the skills root (three cases). */
async function checkOrphanLinks(entries: SkillEntry[]): Promise<DoctorCheck> {
  const found = await findOrphanLinks(entries)
  const issues = found.map<DoctorIssue>(orphanLinkIssue)
  return finalize('orphan-link', issues.length === 0 ? 'none' : undefined, issues)
}

function orphanLinkIssue(l: OrphanLink): DoctorIssue {
  switch (l.code) {
    case 'dangling-link':
      return {
        severity: 'error',
        code: 'dangling-link',
        name: l.name,
        fix: `remove the dangling symlink at ~/.dsh/skills/${l.name}`,
      }
    case 'orphan-link':
      return {
        severity: 'warn',
        code: 'orphan-link',
        name: l.name,
        fix: `remove ~/.dsh/skills/${l.name}, or re-add it as a skill`,
      }
    default:
      // unreadable-link: cannot confirm nexus ownership → caution, no delete hint.
      return {
        severity: 'warn',
        code: 'unreadable-link',
        name: l.name,
        detail: 'symlink is unreadable and may not be nexus-managed — inspect manually, do not delete blindly',
      }
  }
}

/** `git-sanity` — each clone has a `.git` (stat probe, no git process). */
async function checkGitSanity(entries: SkillEntry[]): Promise<DoctorCheck> {
  const issues: DoctorIssue[] = []
  let withGit = 0
  for (const e of entries) {
    try {
      await stat(join(repoDir(e.path), '.git'))
      withGit++
    } catch {
      issues.push({
        severity: 'warn',
        code: 'missing-git',
        name: e.name,
        fix: `dsh-skills-nexus update ${e.name}`,
      })
    }
  }
  const detail =
    entries.length === 0 ? 'no clones' : `${withGit}/${entries.length} clones have .git`
  return finalize('git-sanity', detail, issues)
}

/**
 * `updates` (P2, network) — compare branch-pinned entries against their remote.
 * Tag/commit pins (detached HEAD) are intentionally version-locked and reported
 * as `locked` (info), never as "behind". Results never affect the exit code.
 */
async function checkUpdates(entries: SkillEntry[]): Promise<DoctorCheck> {
  const issues: DoctorIssue[] = []
  for (const e of entries) {
    const dir = repoDir(e.path)
    try {
      await stat(dir)
    } catch {
      continue // clone absent — git-sanity already flags it
    }

    let locked = false
    try {
      locked = await isDetachedHead(dir)
    } catch {
      locked = false
    }
    if (locked) {
      issues.push({
        severity: 'info',
        code: 'locked',
        name: e.name,
        detail: `pinned at ${e.ref} — intentionally not tracking remote`,
      })
      continue
    }

    const remote = await lsRemoteCommit(e.gitUrl, e.ref)
    if (remote && e.commit && remote !== e.commit) {
      issues.push({
        severity: 'info',
        code: 'behind-remote',
        name: e.name,
        detail: `local ${short(e.commit)}, remote ${short(remote)}`,
        fix: `dsh-skills-nexus update ${e.name}`,
      })
    }
  }

  const behind = issues.some((i) => i.code === 'behind-remote')
  return { id: 'updates', status: behind ? 'update-available' : 'ok', issues }
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

function finalize(id: string, detail: string | undefined, issues: DoctorIssue[]): DoctorCheck {
  let status: CheckStatus = 'ok'
  if (issues.some((i) => i.severity === 'error')) status = 'error'
  else if (issues.some((i) => i.severity === 'warn')) status = 'warn'
  const check: DoctorCheck = { id, status, issues }
  if (detail !== undefined) check.detail = detail
  return check
}

function summarize(checks: DoctorCheck[]): { errors: number; warnings: number; updates: number } {
  let errors = 0
  let warnings = 0
  let updates = 0
  for (const c of checks) {
    for (const i of c.issues) {
      if (i.severity === 'error') errors++
      else if (i.severity === 'warn') warnings++
      else if (i.code === 'behind-remote') updates++
    }
  }
  return { errors, warnings, updates }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function short(sha: string): string {
  return sha.slice(0, 7)
}

/* ------------------------------------------------------------------ */
/* Human-readable formatting (pure)                                    */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'ok',
  warn: 'warn',
  error: 'FAIL',
  'update-available': 'update',
}

const DEFAULT_DESC: Record<string, string> = {
  'missing-target': 'symlink points to missing directory',
  'orphan-repo': 'not referenced by any manifest entry',
  'dangling-link': 'symlink points to a missing directory (no manifest entry)',
  'orphan-link': 'symlink has no matching manifest entry',
  'unreadable-link': 'symlink is unreadable (may not be nexus-managed)',
  'orphan-check-skipped': 'not scanned — manifest unreadable',
  'missing-git': 'clone is missing .git',
  'corrupt-manifest': 'manifest is corrupt or malformed',
  'corrupt-backup': 'found a past corruption backup',
  'root-unreadable': 'root directory is unreadable',
  'behind-remote': 'behind remote',
  locked: 'pinned — not tracking remote',
}

function humanIssueText(i: DoctorIssue): string {
  return `${i.name}: ${i.detail ?? DEFAULT_DESC[i.code] ?? i.code}`
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)]
}

/** Render the report as the aligned, human-readable report (stdout). */
export function formatHuman(report: DoctorReport): string {
  const idW = Math.max(4, ...report.checks.map((c) => c.id.length))
  const lines: string[] = []
  const fixes: string[] = []

  for (const c of report.checks) {
    const label = STATUS_LABEL[c.status]
    if (c.issues.length === 0) {
      lines.push(`${c.id.padEnd(idW)}  ${label.padEnd(6)}  ${c.detail ?? 'ok'}`)
    } else {
      const [first, ...rest] = c.issues
      lines.push(`${c.id.padEnd(idW)}  ${label.padEnd(6)}  ${humanIssueText(first!)}`)
      for (const i of rest) lines.push(`${' '.repeat(idW + 8)}${humanIssueText(i)}`)
      for (const i of c.issues) if (i.fix) fixes.push(i.fix)
    }
  }

  const s = report.summary
  lines.push('')
  const parts = [`${s.errors} error(s)`, `${s.warnings} warning(s)`]
  if (s.updates > 0) parts.push(`${s.updates} update(s) available`)
  lines.push(`${parts.join(', ')}.`)

  if (fixes.length > 0) {
    lines.push('Fix hints:')
    for (const f of dedupe(fixes)) lines.push(`  - ${f}`)
  }

  return `${lines.join('\n')}\n`
}

/* ------------------------------------------------------------------ */
/* Command entry                                                       */
/* ------------------------------------------------------------------ */

export async function doctor(argv: string[]): Promise<number> {
  let opts: DoctorOptions
  try {
    opts = parseDoctorArgs(argv)
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  const report = await runChecks(opts.updates)
  const hasErrors = report.summary.errors > 0

  // --quiet: stay silent unless something is actually broken.
  if (opts.quiet && !hasErrors) return 0

  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(formatHuman(report))

  return hasErrors ? 1 : 0
}

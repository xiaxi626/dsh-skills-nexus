/**
 * Integrity checks for nexus-managed skills.
 *
 * Surfaced by the `doctor` CLI command — NOT from the plugin `apply()`, which
 * is an intentional no-op (a startup-time warning has no verified visible
 * output channel in DSH). Verifies that each manifest entry's symlinks in the
 * official skills root still point at valid target directories, scans for
 * orphaned clones / links left behind when the manifest and the filesystem
 * drift apart, and hosts `checkUpdates` — the network comparison behind
 * `doctor --updates`, extracted here so the check-updates route can reuse the
 * exact same implementation (§6.3).
 *
 * The diagnosis functions are purely filesystem-based; `checkUpdates` is the
 * module's one git/network operation. It records its results in the runtime
 * update cache (§5.2) and never persists anything to disk.
 *
 * Design constraints:
 *   - Must never throw (it runs inside a read-only diagnostic command).
 *   - Disabled entries (no symlink) are normal and NOT reported.
 *   - Only missing targets produce issues.
 */

import { readdir, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { OFFICIAL_SKILLS_DIR, REPOS_DIR, repoDir } from './paths.js'
import { isLinkAt, readLinkEntryTarget, safeRealPath } from './link.js'
import { readManifest } from './manifest.js'
import { isDetachedHead, lsRemoteCommit } from './git.js'
import { setUpdateStatus } from './update-cache.js'
import { cliIO } from './ops-io.js'
import type { OpsIO } from './ops-io.js'
import type { SkillEntry } from './types.js'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EntryDiagnosis = 'ok' | 'disabled' | 'missing-target'

export interface HealthIssue {
  name: string
  issue: 'missing-target'
}

/* ------------------------------------------------------------------ */
/* Core diagnosis                                                      */
/* ------------------------------------------------------------------ */

/**
 * Diagnose a single manifest entry's symlink health.
 *
 * Scans `OFFICIAL_SKILLS_DIR` for symlinks whose resolved target falls inside
 * `repoDir(entry.path)`. Then verifies the target directory actually exists.
 *
 * Returns:
 *   - 'ok'             — at least one symlink points to a valid, existing directory
 *   - 'disabled'       — no symlink in the skills root points to this entry (normal)
 *   - 'missing-target' — a symlink was found and resolved, but the target directory does not exist
 *
 * A link whose target cannot be resolved at all cannot be attributed to any
 * entry, so it is skipped here; the FS-side `findOrphanLinks()` scan reports it
 * instead as an `unreadable-link`.
 *
 * Targets are read with `resolveLinkTarget` (`realpath`), not
 * `lstat` + `readlink`: on Windows `linkSkill` creates an NTFS junction, which
 * `lstat` reports as a plain directory and `readlink` refuses with `EINVAL`, so
 * the old pair classified every healthy junction as "disabled" and every broken
 * one as "disabled" too — a check that could not see the thing it checks.
 */
export async function diagnoseEntry(entry: SkillEntry): Promise<EntryDiagnosis> {
  const base = await safeRealPath(repoDir(entry.path)) + sep

  let names: string[]
  try {
    names = await readdir(OFFICIAL_SKILLS_DIR)
  } catch {
    // Skills root doesn't exist — everything is effectively disabled.
    return 'disabled'
  }

  let foundLink = false
  let brokenLink = false

  for (const name of names) {
    const linkPath = resolve(OFFICIAL_SKILLS_DIR, name)

    const target = await readLinkEntryTarget(linkPath)
    if (target === undefined) {
      // No target to read. POSIX always answers for a link, so this is a
      // Windows junction with a deleted target: `realpath` and `readlink` both
      // refuse such a reparse point. It is still a link nexus created, and its
      // target is gone by definition, so the entry it belonged to is broken —
      // but which entry that is cannot be recovered, so it only counts when
      // nothing healthy shows up for the entry being diagnosed.
      if (await isLinkAt(linkPath)) {
        foundLink = true
        brokenLink = true
      }
      continue
    }

    const resolved = await safeRealPath(target)

    // Does this link point inside the entry's repo directory?
    if (resolved !== base.slice(0, -1) && !resolved.startsWith(base)) continue

    foundLink = true

    // Verify the target directory actually exists
    try {
      const targetStat = await stat(resolved)
      if (targetStat.isDirectory()) {
        // At least one healthy link exists — entry is ok.
        return 'ok'
      }
    } catch {
      // Target path doesn't exist on disk.
      brokenLink = true
      // Continue scanning — there might be another link that IS valid.
      continue
    }
  }

  if (!foundLink) return 'disabled'
  // A link that resolves into this entry but has no target left: the entry is
  // broken and `update` can repair it.
  if (brokenLink) return 'missing-target'
  return 'disabled'
}

/* ------------------------------------------------------------------ */
/* Batch health check                                                  */
/* ------------------------------------------------------------------ */

/**
 * Run health check on all manifest entries.
 * Returns only entries with real problems (missing-target).
 * Disabled entries are normal and excluded from results.
 */
export async function checkHealth(): Promise<HealthIssue[]> {
  const manifest = await readManifest()
  if (manifest.skills.length === 0) return []

  const issues: HealthIssue[] = []

  for (const entry of manifest.skills) {
    const diagnosis = await diagnoseEntry(entry)
    if (diagnosis === 'missing-target') {
      issues.push({ name: entry.name, issue: diagnosis })
    }
  }

  return issues
}

/* ------------------------------------------------------------------ */
/* Output formatting                                                   */
/* ------------------------------------------------------------------ */

/** Format health issues into a human-readable warning string. */
export function formatWarning(issues: HealthIssue[]): string {
  if (issues.length === 0) return ''

  const count = issues.length
  const noun = count === 1 ? 'skill has a broken symlink' : 'skills have broken symlinks'
  const lines: string[] = [`[nexus] Warning: ${count} ${noun}:`]

  for (const { name } of issues) {
    lines.push(`  - ${name} (symlink points to missing directory)`)
  }

  const first = issues[0]
  if (count === 1 && first) {
    lines.push(`  Run \`dsh-skills-nexus update ${first.name}\` to re-clone and repair.`)
  } else {
    lines.push('  Run `dsh-skills-nexus update <name>` to repair individually.')
  }

  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Orphan detection (FS-side scans; complement the manifest-side checks)*/
/* ------------------------------------------------------------------ */

/**
 * Repo clone directories under `REPOS_DIR` that no manifest entry references —
 * leftover clones from an entry that was removed (or a manifest that was reset).
 * Returns repo-relative directory names (the top-level segment under `repos/`).
 */
export async function findOrphanRepos(entries: SkillEntry[]): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(REPOS_DIR)
  } catch {
    return [] // repos/ not created yet — nothing can be orphaned
  }

  // A top-level dir is referenced if some entry.path equals it or nests under it.
  const referenced = (dir: string): boolean =>
    entries.some(
      (e) => e.path === dir || e.path.startsWith(dir + sep) || e.path.startsWith(dir + '/'),
    )

  const orphans: string[] = []
  for (const name of names) {
    const abs = resolve(REPOS_DIR, name)
    let st
    try {
      st = await stat(abs)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    if (!referenced(name)) orphans.push(name)
  }
  return orphans
}

export type OrphanLinkCode = 'unreadable-link' | 'dangling-link' | 'orphan-link'

export interface OrphanLink {
  /** Symlink name in the official skills root. */
  name: string
  code: OrphanLinkCode
  /** Resolved target path (absent for `unreadable-link`). */
  target?: string
}

/**
 * Links in `OFFICIAL_SKILLS_DIR` that nexus can no longer account for.
 *
 * Only links whose resolved target falls inside `REPOS_DIR` are considered —
 * anything pointing elsewhere is the user's own skill, not nexus's business.
 * Three cases:
 *   - `unreadable-link` — the target cannot be resolved at all; the target is
 *     unknown, so the link cannot be attributed to nexus. A caution only —
 *     never a delete hint.
 *   - `dangling-link`   — target resolves inside repos/ but no longer exists.
 *   - `orphan-link`     — target exists inside repos/ but no entry claims it.
 *
 * A link that a live entry *does* claim is skipped here — `diagnoseEntry`
 * already reports its health, so this avoids double-reporting the same problem.
 *
 * Reading through `resolveLinkTarget` is what makes a Windows junction visible
 * at all (`lstat` reports one as a plain directory, so the former
 * `isSymbolicLink()` guard skipped every link nexus had created). The
 * `unreadable-link` case keeps its meaning — a target that truly cannot be
 * resolved — while a junction whose target was deleted now correctly lands in
 * `dangling-link`, which is the actionable one.
 */
export async function findOrphanLinks(entries: SkillEntry[]): Promise<OrphanLink[]> {
  let names: string[]
  try {
    names = await readdir(OFFICIAL_SKILLS_DIR)
  } catch {
    return [] // skills root absent — nothing to scan
  }

  const reposBase = await safeRealPath(REPOS_DIR) + sep
  const bases = await Promise.all(entries.map((e) => safeRealPath(repoDir(e.path))))
  const basesWithSep = bases.map((b) => b + sep)
  const claimedBy = (resolved: string): boolean =>
    basesWithSep.some((b) => resolved === b.slice(0, -1) || resolved.startsWith(b))

  const out: OrphanLink[] = []
  for (const name of names) {
    const linkPath = resolve(OFFICIAL_SKILLS_DIR, name)

    // A real directory or file the user placed here is not nexus's business.
    if (!(await isLinkAt(linkPath))) continue

    const target = await readLinkEntryTarget(linkPath)
    if (target === undefined) {
      // The target is genuinely unknown. On POSIX this cannot happen for a link
      // (`readlink` always answers), so it means a Windows junction whose target
      // was deleted: `realpath` and `readlink` both refuse such a reparse point
      // and `lstat` reports a plain directory, so there is nothing left to
      // attribute it with. Reported as `unreadable-link` — a caution, never a
      // delete hint — rather than guessed at.
      out.push({ name, code: 'unreadable-link' })
      continue
    }

    const resolved = await safeRealPath(target)
    // Only links pointing into repos/ are nexus's concern.
    if (resolved !== reposBase.slice(0, -1) && !resolved.startsWith(reposBase)) continue
    // A live entry claims it → diagnoseEntry handles its health; skip.
    if (claimedBy(resolved)) continue

    let exists = false
    try {
      const tst = await stat(resolved)
      exists = tst.isDirectory()
    } catch {
      exists = false
    }
    out.push({ name, code: exists ? 'orphan-link' : 'dangling-link', target: resolved })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Update comparison (network) — `doctor --updates` core, extracted    */
/* ------------------------------------------------------------------ */

/**
 * Per-entry outcome of one network comparison. `behind-remote` and `current`
 * are based on a resolved remote; the rest are reasons an entry was left
 * unchecked:
 *   - `locked`         — detached HEAD (tag/commit pin), version-locked by design
 *   - `absent`         — the clone directory does not exist (nothing to compare)
 *   - `not-applicable` — no git source: no remote to compare against (§5.3)
 *   - `unresolved`     — ls-remote failed (offline / private repo / bad ref)
 */
export type UpdateCheckStatus =
  | 'behind-remote'
  | 'current'
  | 'locked'
  | 'absent'
  | 'not-applicable'
  | 'unresolved'

export interface UpdateCheck {
  name: string
  status: UpdateCheckStatus
  /** Commit recorded in the manifest (when present and a remote was resolved). */
  local?: string
  /** Commit resolved from the remote (only for `behind-remote` / `current`). */
  remote?: string
}

/**
 * Compare manifest entries against their remotes (network) and record every
 * comparison in the runtime update cache (§5.2) — nothing is written to disk.
 * Extracted from `doctor --updates` so the plugin's check-updates route can
 * share one implementation (§6.3).
 *
 * `names` limits the check to those entry names (an empty array checks
 * nothing); omitted checks every manifest entry, in manifest order. The
 * returned array covers exactly the entries that were visited.
 *
 * Cache writes mirror the list route's `update` object (§7.2):
 *   - `behind-remote` / `current` → `{ hasUpdate, latestCommit: remote }`
 *   - `unresolved`                → `{ hasUpdate: false, latestCommit: null }`
 *   - `locked` / `absent` / `not-applicable` → no write: pinned and non-git
 *     entries stay `null` in the list response rather than "checked" (§7.2).
 *
 * Never throws: every filesystem/git failure degrades to a status.
 */
export async function checkUpdates(
  names?: string[],
  io: OpsIO = cliIO,
): Promise<UpdateCheck[]> {
  const manifest = await readManifest()
  const wanted = names === undefined ? undefined : new Set(names)
  const results: UpdateCheck[] = []
  for (const entry of manifest.skills) {
    if (wanted !== undefined && !wanted.has(entry.name)) continue
    results.push(await checkEntryUpdate(entry, io))
  }
  return results
}

async function checkEntryUpdate(e: SkillEntry, io: OpsIO): Promise<UpdateCheck> {
  // Entries without a git source have no remote to compare against.
  if (e.gitUrl.length === 0) {
    return { name: e.name, status: 'not-applicable' }
  }

  const dir = repoDir(e.path)
  try {
    await stat(dir)
  } catch {
    return { name: e.name, status: 'absent' }
  }

  // Detached HEAD = tag/commit pin — version-locked, never "behind" (§7.2).
  const locked = await isDetachedHead(dir).catch(() => false)
  if (locked) return { name: e.name, status: 'locked' }

  io.progress('checking updates', e.name)
  const remote = await lsRemoteCommit(e.gitUrl, e.ref)
  const checkedAt = new Date().toISOString()

  if (remote === undefined) {
    setUpdateStatus(e.name, { hasUpdate: false, latestCommit: null, checkedAt })
    return { name: e.name, status: 'unresolved' }
  }

  const local = e.commit ?? ''
  const behind = local.length > 0 && remote !== local
  setUpdateStatus(e.name, { hasUpdate: behind, latestCommit: remote, checkedAt })
  return behind
    ? { name: e.name, status: 'behind-remote', local, remote }
    : { name: e.name, status: 'current', local: local.length > 0 ? local : undefined, remote }
}
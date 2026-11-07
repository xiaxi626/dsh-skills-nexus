/**
 * Project-scope skills: links under `<projectRoot>/.dsh/skills/`.
 *
 * The DSH filesystem provider scans that directory at rank 100 — ahead of the
 * user-level root nexus otherwise maintains — so a link placed there shadows a
 * global skill of the same name without any registration step. This module is
 * therefore deliberately stateless: it scans, creates and removes links, and
 * keeps no record beyond the filesystem itself.
 *
 * The ownership rule that makes project scope safe:
 *
 *   - nexus only ever creates a link;
 *   - it only removes something it has proven to be a link (`isLinkAt`);
 *   - a real directory or file the user vendored into the project is reported
 *     and never touched.
 *
 * No manifest entry, clone or copy is involved, so none of the manifest lock,
 * migration or "stale projectRoot" failure modes apply.
 */

import { createHash } from 'node:crypto'
import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { sanitizeName } from './git.js'
import {
  hasCollision,
  isLinkAt,
  linkAt,
  readLinkEntryTarget,
  safeRealPath,
  unlinkAt,
} from './link.js'
import { withSkillFileLock } from './locks.js'
import { projectSkillsDir } from './paths.js'
import { previewSkills } from './resolve.js'
import type { ParsedSkill } from './resolve.js'
import type { OpsIO } from './ops-io.js'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * A clear refusal for a source directory nexus cannot link, or `undefined`.
 *
 * Windows junctions require a local absolute target: `symlink(..., 'junction')`
 * answers a UNC path (\servershare\…) with a raw `EPERM`, which reads like a
 * permissions problem rather than an unsupported target. The check is confined
 * to win32 because a leading `//` is an ordinary path elsewhere.
 */
export function projectSourceError(source: string): string | undefined {
  if (process.platform === 'win32' && /^[\\/]{2}[^\\/?]/.test(source)) {
    return (
      `Windows junctions cannot target a UNC path ("${source}"); ` +
      'map the share to a local drive and link that path instead'
    )
  }
  return undefined
}

/** One entry found directly under `<projectRoot>/.dsh/skills/`. */
export interface ProjectSkillEntry {
  name: string
  /** Absolute path of the entry itself. */
  path: string
  /** `link` = a symlink/junction nexus can manage; `files` = user content. */
  kind: 'link' | 'files'
  /** Resolved (or recovered) link target; `null` for `files` and unrecoverable links. */
  target: string | null
  /** True when a link's target is missing or is not a directory. */
  dangling: boolean
}

/**
 * What `planProjectLink` decided for one discovered skill:
 *
 *   - `link`      — nothing at the name yet, a link will be created;
 *   - `replace`   — a link (possibly dangling) already owns the name;
 *   - `unchanged` — a link already points at exactly this directory;
 *   - `collision` — a real directory/file owns the name, or two skills in the
 *                    same scan derive the same name;
 *   - `invalid`   — no DSH-valid name can be derived.
 */
export type ProjectLinkStatus = 'link' | 'replace' | 'unchanged' | 'collision' | 'invalid'

export interface ProjectLinkResult {
  name: string
  target: string | null
  status: ProjectLinkStatus
  /** Set when the entry cannot be (or failed to be) linked. */
  error?: string
}

export interface ProjectLinkPlan {
  root: string
  source: string
  results: ProjectLinkResult[]
}

export interface ProjectLinkSummary {
  linked: number
  replaced: number
  unchanged: number
  failed: number
}

export type ProjectRemoveStatus = 'removed' | 'not-found' | 'not-a-link'

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

/** Absolute path of one entry in the project skills root. */
export function projectSkillPath(root: string, name: string): string {
  return join(projectSkillsDir(root), name)
}

/**
 * Scan `<projectRoot>/.dsh/skills/` (one level, like the provider) and
 * classify every entry by what is on disk.
 *
 * A link is `dangling` when its target cannot be resolved or is not a
 * directory. The target string is still reported whenever `readlink` can
 * recover it, so a link whose directory was deleted remains diagnosable rather
 * than anonymous. Missing/unreadable roots list as empty — a project with no
 * project skills is normal, not an error.
 */
export async function listProjectSkills(root: string): Promise<ProjectSkillEntry[]> {
  const dir = projectSkillsDir(root)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const entries: ProjectSkillEntry[] = []
  for (const name of names) {
    const path = join(dir, name)
    if (!(await isLinkAt(path))) {
      entries.push({ name, path, kind: 'files', target: null, dangling: false })
      continue
    }
    const target = (await readLinkEntryTarget(path)) ?? null
    entries.push({ name, path, kind: 'link', target, dangling: await isDangling(target) })
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return entries
}

/** True when a link target is unusable: absent, or not a directory. */
async function isDangling(target: string | null): Promise<boolean> {
  if (target === null) return true
  try {
    return !(await stat(target)).isDirectory()
  } catch {
    return true
  }
}

/* ------------------------------------------------------------------ */
/* Linking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derive the link name for one discovered skill.
 *
 * DSH identifies a skill by its **directory name** under a skills root, so the
 * link must carry the directory's name — not the frontmatter `name`, which may
 * disagree with the directory (a mismatch the provider resolves in favour of
 * the directory). Layouts map as:
 *
 *   - `<root>/SKILL.md`      → the root directory's name;
 *   - `<root>/<dir>/SKILL.md` → `<dir>`;
 *   - `<root>/<file>.md`      → the file stem.
 *
 * Only when that directory name has nothing a DSH name can be built from (a
 * fully non-ASCII directory, say) does the frontmatter name become the fallback
 * — `sanitizeName` would otherwise collapse every such directory to `skill`
 * and make them collide.
 */
function deriveName(skill: ParsedSkill): { name: string } | { error: string } {
  const file = basename(skill.skillFile)
  const raw =
    file.toLowerCase() === 'skill.md'
      ? basename(skill.resourceBase)
      : file.replace(/\.md$/i, '')

  if (/[a-z0-9]/.test(raw.toLowerCase())) return { name: sanitizeName(raw) }
  if (skill.name.length > 0) return { name: sanitizeName(skill.name) }
  return {
    error:
      `cannot derive a DSH skill name from "${raw}" — ` +
      'rename the directory or give the skill a valid frontmatter name',
  }
}

/**
 * Build a link plan without touching the filesystem.
 *
 * The first skill that claims a name wins; a second one deriving the same name
 * in the same scan is reported as a collision instead of silently overwriting
 * the first (the two skills have different targets, so no order-independent
 * answer exists). An existing link is `replace` unless it already points at
 * the same directory; user content is always `collision`.
 */
export async function planProjectLink(root: string, sourceDir: string): Promise<ProjectLinkPlan> {
  const projectRoot = resolve(root)
  const source = resolve(sourceDir)
  const unsupported = projectSourceError(source)
  if (unsupported !== undefined) {
    // Reported as a plan result rather than thrown: the CLI and the HTTP route
    // both render results, so one shape carries "cannot link this directory".
    return {
      root: projectRoot,
      source,
      results: [
        {
          name: sanitizeName(basename(source)),
          target: source,
          status: 'invalid',
          error: unsupported,
        },
      ],
    }
  }
  const dir = projectSkillsDir(projectRoot)
  const skills = await previewSkills(source)

  const results: ProjectLinkResult[] = []
  const claimed = new Map<string, string>()

  for (const skill of skills) {
    const derived = deriveName(skill)
    if ('error' in derived) {
      results.push({ name: basename(skill.resourceBase), target: skill.resourceBase, status: 'invalid', error: derived.error })
      continue
    }

    const name = derived.name
    const target = skill.resourceBase
    const previous = claimed.get(name)
    if (previous !== undefined) {
      results.push({
        name,
        target,
        status: 'collision',
        error: `another skill in this scan already claims "${name}" (${previous})`,
      })
      continue
    }
    claimed.set(name, target)

    const linkPath = join(dir, name)
    if (await hasCollision(name, dir)) {
      results.push({
        name,
        target,
        status: 'collision',
        error: `a real directory or file already exists at ${linkPath} — refusing to replace user content`,
      })
      continue
    }
    if (await isLinkAt(linkPath)) {
      const current = await readLinkEntryTarget(linkPath)
      const unchanged =
        current !== undefined &&
        (await safeRealPath(current)) === (await safeRealPath(target))
      results.push({ name, target, status: unchanged ? 'unchanged' : 'replace' })
      continue
    }
    results.push({ name, target, status: 'link' })
  }

  return { root: projectRoot, source, results }
}

/**
 * Execute a plan: create one link per `link`/`replace` result.
 *
 * Each name is written under its own cross-process lock so a CLI invocation and
 * a panel request for the same project + skill cannot interleave. The lock key
 * mixes a hash of the canonical project root with the skill name, because two
 * projects may legitimately link the same skill name at the same time. A
 * failure is recorded on its result instead of aborting the batch — the caller
 * reports per-item outcomes and derives the exit code from them.
 */
export async function applyProjectLink(plan: ProjectLinkPlan, io: OpsIO): Promise<ProjectLinkPlan> {
  const dir = projectSkillsDir(plan.root)
  const rootTag = await projectLockTag(plan.root)

  for (const result of plan.results) {
    if (result.status !== 'link' && result.status !== 'replace') continue
    if (result.target === null) {
      result.error = 'no target directory'
      continue
    }
    io.progress('linking', `${result.name} → ${result.target}`)
    try {
      await withSkillFileLock(`${rootTag}-${result.name}`, () =>
        linkAt(join(dir, result.name), result.target!),
      )
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
    }
  }

  return plan
}

/** Count a plan's outcomes (a result that carries an error counts as failed). */
export function summarizeProjectLink(plan: ProjectLinkPlan): ProjectLinkSummary {
  const summary: ProjectLinkSummary = { linked: 0, replaced: 0, unchanged: 0, failed: 0 }
  for (const result of plan.results) {
    if (result.error !== undefined) summary.failed++
    else if (result.status === 'link') summary.linked++
    else if (result.status === 'replace') summary.replaced++
    else if (result.status === 'unchanged') summary.unchanged++
    else summary.failed++
  }
  return summary
}

/** Canonical-root tag that keeps two projects' locks independent. */
async function projectLockTag(root: string): Promise<string> {
  return createHash('sha1').update(await safeRealPath(root)).digest('hex').slice(0, 12)
}

/* ------------------------------------------------------------------ */
/* Removing                                                            */
/* ------------------------------------------------------------------ */

/**
 * True when `name` can only address one direct child of the project skills
 * root. Rejects separators and dot segments before any path is joined, so a
 * request can never walk out of the root.
 */
function isDirectChildName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

/**
 * Remove the link called `name` from the project skills root.
 *
 * Only a proven link is removed. A real directory or file returns `not-a-link`
 * and is left byte-for-byte untouched — the whole safety argument of project
 * scope, so `unlinkAt`'s refusal is surfaced rather than worked around.
 */
export async function removeProjectLink(root: string, name: string): Promise<ProjectRemoveStatus> {
  if (!isDirectChildName(name)) return 'not-found'
  const linkPath = projectSkillPath(root, name)

  try {
    await lstat(linkPath)
  } catch {
    return 'not-found'
  }
  if (!(await isLinkAt(linkPath))) return 'not-a-link'

  const rootTag = await projectLockTag(root)
  const removed = await withSkillFileLock(`${rootTag}-${name}`, () => unlinkAt(linkPath))
  return removed ? 'removed' : 'not-a-link'
}

/* ------------------------------------------------------------------ */
/* Doctor                                                              */
/* ------------------------------------------------------------------ */

/** Every dangling link in the project skills root (doctor's project check). */
export async function projectDanglingLinks(
  root: string,
): Promise<Array<{ name: string; target: string | null }>> {
  const entries = await listProjectSkills(root)
  return entries
    .filter((entry) => entry.kind === 'link' && entry.dangling)
    .map((entry) => ({ name: entry.name, target: entry.target }))
}

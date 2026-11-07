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
import { lstat, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
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
import { projectDisabledSkillsDir, projectSkillsDir } from './paths.js'
import { isValidSkillName, previewSkills } from './resolve.js'
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

/** Parsed metadata of a skill file, read-only. */
export interface ProjectSkillInfo {
  /** Catalog name: a valid frontmatter `name`, or a sanitized fallback. */
  name: string
  description: string
  skillFile: string
  resourceBase: string
  /** True when frontmatter carries a valid name and a non-empty description. */
  valid: boolean
  /** Frontmatter name that failed DSH's kebab-case rule, when one was present. */
  invalidName?: string
  /** Why this file is not a usable skill (missing name/description, unreadable). */
  error?: string
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
  /** True for active entries; false for a link parked under `skills-disabled`. */
  enabled: boolean
  /** Read-only metadata parsed from the entry (or a link's target), when it is a skill. */
  skill: ProjectSkillInfo | null
}

/**
 * A skill **provided by the project folder itself** — the `SKILL.md` at the
 * root, one-level subdirectories, or flat `.md` files. This is the source side
 * of the project page: it is what `link --project` would link, and it is shown
 * even when the folder is not registered as a DSH workspace.
 */
export interface ProjectFolderSkill extends ProjectSkillInfo {
  /** True when an active link in `<root>/.dsh/skills` points at this resource base. */
  linked: boolean
  /** Name of the active or disabled link, or `null` when there is none. */
  linkName: string | null
  /** True when the only link for this resource base is parked as disabled. */
  disabled: boolean
}

/** Result of moving a project link between active and disabled. */
export type ProjectToggleStatus =
  | 'enabled'
  | 'disabled'
  | 'already-enabled'
  | 'already-disabled'
  | 'not-found'
  | 'not-a-link'
  | 'collision'
  | 'failed'

/** The project page's one read-only report. */
export interface ProjectReport {
  projectRoot: string
  folderSkills: ProjectFolderSkill[]
  entries: ProjectSkillEntry[]
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
  const scans = [
    { dir: projectSkillsDir(root), enabled: true },
    { dir: projectDisabledSkillsDir(root), enabled: false },
  ]
  const entries: ProjectSkillEntry[] = []
  const seen = new Set<string>()

  for (const { dir, enabled } of scans) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      // The active root wins if both roots somehow carry the same name.
      if (seen.has(name)) continue
      seen.add(name)
      const path = join(dir, name)
      if (!(await isLinkAt(path))) {
        const skill = await readSkillInfo(path)
        entries.push({ name, path, kind: 'files', target: null, dangling: false, enabled, skill })
        continue
      }
      const target = (await readLinkEntryTarget(path)) ?? null
      const dangling = await isDangling(target)
      const skill = target !== null && !dangling ? await readSkillInfo(target) : null
      entries.push({ name, path, kind: 'link', target, dangling, enabled, skill })
    }
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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function existsAt(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Read the skill metadata at `path` without writing anything.
 *
 * A directory is a bundle when it carries `SKILL.md`; a top-level `.md` file is
 * a flat skill. Anything else is not a skill and returns `null`, which lets the
 * caller keep listing it as user content instead of dropping it from view.
 */
async function readSkillInfo(path: string): Promise<ProjectSkillInfo | null> {
  let skillFile: string
  let resourceBase: string
  let bundle: boolean
  try {
    const st = await stat(path)
    if (st.isDirectory()) {
      bundle = true
      resourceBase = path
      skillFile = join(path, 'SKILL.md')
      if (!(await isFile(skillFile))) return null
    } else if (st.isFile() && path.toLowerCase().endsWith('.md')) {
      bundle = false
      skillFile = path
      resourceBase = dirname(path)
    } else {
      return null
    }
  } catch {
    return null
  }
  return readSkillFile(skillFile, resourceBase, bundle)
}

/** Parse one `SKILL.md` (or flat `.md`) into display metadata, never throwing. */
async function readSkillFile(
  skillFile: string,
  resourceBase: string,
  bundle: boolean,
): Promise<ProjectSkillInfo> {
  let raw: string
  try {
    raw = await readFile(skillFile, 'utf8')
  } catch {
    return {
      name: '',
      description: '',
      skillFile,
      resourceBase,
      valid: false,
      error: 'skill file is unreadable',
    }
  }

  const { frontmatter, description } = parseFrontmatter(raw)
  const fmName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
  const fallbackRaw = bundle ? basename(resourceBase) : basename(skillFile).replace(/\.md$/i, '')
  const name = isValidSkillName(fmName) ? fmName : sanitizeName(fallbackRaw)
  const valid = isValidSkillName(fmName) && description.length > 0
  const error = !isValidSkillName(fmName)
    ? fmName.length > 0
      ? `invalid frontmatter name "${fmName}"`
      : 'missing frontmatter name'
    : description.length === 0
      ? 'missing frontmatter description'
      : undefined

  return {
    name,
    description,
    skillFile,
    resourceBase,
    valid,
    ...(fmName.length > 0 && !isValidSkillName(fmName) ? { invalidName: fmName } : {}),
    ...(error === undefined ? {} : { error }),
  }
}

/** Turn one scanned folder skill into display metadata plus its link state. */
function folderSkillFromParsed(
  skill: ParsedSkill,
  activeLink: string | null,
  disabledLink: string | null,
): ProjectFolderSkill {
  const derived = deriveName(skill)
  const fallback = 'name' in derived ? derived.name : sanitizeName(basename(skill.resourceBase))
  const name = isValidSkillName(skill.name) ? skill.name : fallback
  const valid = isValidSkillName(skill.name) && skill.description.length > 0
  const error = !isValidSkillName(skill.name)
    ? skill.invalidName !== undefined
      ? `invalid frontmatter name "${skill.invalidName}"`
      : 'missing frontmatter name'
    : skill.description.length === 0
      ? 'missing frontmatter description'
      : undefined

  return {
    name,
    description: skill.description,
    skillFile: skill.skillFile,
    resourceBase: skill.resourceBase,
    valid,
    ...(skill.invalidName === undefined ? {} : { invalidName: skill.invalidName }),
    ...(error === undefined ? {} : { error }),
    linked: activeLink !== null,
    linkName: activeLink ?? disabledLink,
    disabled: activeLink === null && disabledLink !== null,
  }
}

/**
 * Scan the project folder's **own** skills (root `SKILL.md`, one-level
 * subdirectories, flat `.md` files) and mark which ones already have a link in
 * `<root>/.dsh/skills`. Read-only: this is the source side of the page, not a
 * managed project entry.
 */
export async function scanProjectFolder(
  root: string,
  entries?: ProjectSkillEntry[],
): Promise<ProjectFolderSkill[]> {
  const projectRoot = resolve(root)
  const listed = entries ?? (await listProjectSkills(projectRoot))
  const activeByTarget = new Map<string, string>()
  const disabledByTarget = new Map<string, string>()
  for (const entry of listed) {
    if (entry.kind !== 'link' || entry.target === null) continue
    const key = await safeRealPath(entry.target)
    if (entry.enabled) activeByTarget.set(key, entry.name)
    else disabledByTarget.set(key, entry.name)
  }

  const skills = await previewSkills(projectRoot)
  const out: ProjectFolderSkill[] = []
  for (const skill of skills) {
    const key = await safeRealPath(skill.resourceBase)
    out.push(
      folderSkillFromParsed(
        skill,
        activeByTarget.get(key) ?? null,
        disabledByTarget.get(key) ?? null,
      ),
    )
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

/** One read-only report for the project page: folder sources plus installed entries. */
export async function projectReport(root: string): Promise<ProjectReport> {
  const projectRoot = resolve(root)
  const entries = await listProjectSkills(projectRoot)
  const folderSkills = await scanProjectFolder(projectRoot, entries)
  return { projectRoot, folderSkills, entries }
}

/* ------------------------------------------------------------------ */
/* Linking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derive the link name for one discovered skill.
 *
 * The link **entry name** is a filesystem key; DSH's catalog name comes from
 * the frontmatter `name`, which may differ. Nexus prefers the directory name
 * so a link stays stable when frontmatter is normalized later, and falls back
 * to the frontmatter name when the directory has nothing usable. Layouts map as:
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
 * Enable or disable one project link without touching its target.
 *
 * Disabling **moves the link** from `<root>/.dsh/skills/<name>` to the sibling
 * `<root>/.dsh/skills-disabled/<name>`, which the provider does not scan; the
 * link itself still carries the target, so enabling is a move back and no
 * remembered path or state file is needed. A real directory or file at either
 * location is never moved: `not-a-link` / `collision` is returned instead.
 */
export async function setProjectLinkEnabled(
  root: string,
  name: string,
  enabled: boolean,
): Promise<ProjectToggleStatus> {
  if (!isDirectChildName(name)) return 'not-found'
  const projectRoot = resolve(root)
  const active = projectSkillPath(projectRoot, name)
  const disabled = join(projectDisabledSkillsDir(projectRoot), name)

  // Preflight the refusals that need no mutation before creating a lock file:
  // a missing name, a real directory/file, or a collision should read as such
  // even when the lock root itself is not writable. The lock path re-checks
  // everything so a race cannot turn this into a move of user content.
  const activeNow = await existsAt(active)
  const disabledNow = await existsAt(disabled)
  if (enabled) {
    if (activeNow && !(await isLinkAt(active))) return 'collision'
    if (!activeNow && !disabledNow) return 'not-found'
    if (activeNow) return 'already-enabled'
    if (!(await isLinkAt(disabled))) return 'not-a-link'
  } else {
    if (!activeNow && !disabledNow) return 'not-found'
    if (activeNow && !(await isLinkAt(active))) return 'not-a-link'
    if (!activeNow) {
      return (await isLinkAt(disabled)) ? 'already-disabled' : 'not-a-link'
    }
    if (disabledNow) return 'collision'
  }

  const rootTag = await projectLockTag(projectRoot)

  return withSkillFileLock(`${rootTag}-${name}`, async () => {
    const activeExists = await existsAt(active)
    const disabledExists = await existsAt(disabled)

    if (enabled) {
      if (activeExists) return (await isLinkAt(active)) ? 'already-enabled' : 'collision'
      if (!disabledExists) return 'not-found'
      if (!(await isLinkAt(disabled))) return 'not-a-link'
      await mkdir(dirname(active), { recursive: true })
      await rename(disabled, active)
      return 'enabled'
    }

    if (!activeExists) return disabledExists ? 'already-disabled' : 'not-found'
    if (!(await isLinkAt(active))) return 'not-a-link'
    if (disabledExists) return 'collision'
    await mkdir(projectDisabledSkillsDir(projectRoot), { recursive: true })
    await rename(active, disabled)
    return 'disabled'
  })
}

/**
 * Remove the link called `name` from the project skills root.
 *
 * Only a proven link is removed. A real directory or file returns `not-a-link`
 * and is left byte-for-byte untouched — the whole safety argument of project
 * scope, so `unlinkAt`'s refusal is surfaced rather than worked around. A
 * disabled link is removable from its parked location too.
 */
export async function removeProjectLink(root: string, name: string): Promise<ProjectRemoveStatus> {
  if (!isDirectChildName(name)) return 'not-found'
  const candidates = [
    projectSkillPath(root, name),
    join(projectDisabledSkillsDir(root), name),
  ]

  for (const linkPath of candidates) {
    try {
      await lstat(linkPath)
    } catch {
      continue
    }
    if (!(await isLinkAt(linkPath))) return 'not-a-link'

    const rootTag = await projectLockTag(root)
    const removed = await withSkillFileLock(`${rootTag}-${name}`, () => unlinkAt(linkPath))
    return removed ? 'removed' : 'not-a-link'
  }
  return 'not-found'
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
    .filter((entry) => entry.enabled && entry.kind === 'link' && entry.dangling)
    .map((entry) => ({ name: entry.name, target: entry.target }))
}

import { mkdir, readdir, rm } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { addEntry } from './manifest.js'
import { REPOS_DIR, repoDir } from './paths.js'
import {
  cloneRepo,
  getHeadCommit,
  isRealDirectory,
  sanitizeName,
} from './git.js'
import type { CloneResult, GitSpec } from './git.js'
import { classifyRepo } from './repo-kind.js'
import { locateSkillFiles } from './locator.js'
import { previewSkills } from './resolve.js'
import { normalizeSkillName, ensureDescription } from './frontmatter.js'
import { linkSkill } from './link.js'
import type { OpsIO } from './ops-io.js'
import type { SkillEntry } from './types.js'
import { withSpinner } from './cli/progress.js'

/**
 * The one filesystem-mutating install phase for a git source
 * (`clone → classify → normalize → register → link`).
 *
 * §10.1 of `docs/source-and-migration-design.md` requires the new channels to
 * share one core: `import` (installing an entry from a recorded git source)
 * and `adopt` must reuse the very implementation the CLI already runs, the way
 * `src/switch-version.ts` and `src/remove.ts` already do — a second copy of
 * this sequence would drift from the first, and the two front ends would
 * disagree about what "installed" means.
 *
 * This module is that one implementation — `src/import.ts` installs a git
 * source without carrying a third copy of the logic.
 *
 * Both front ends call it: `src/cli/commands/add.ts` for the CLI and the `add`
 * route in `src/http/routes.ts` for the panel. The route used to carry a mirror
 * of it (`installGitCore`), which is exactly the drift §10.1 warns about — the
 * panel now installs through the same code path, and its former `400` codes are
 * rebuilt by the caller from `GitInstallResult.code` (see `GitInstallFailCode`).
 *
 * The caller keeps the read-only preflight and the locking: `add` validates
 * `--subdir`, detects the default branch and refuses re-registration /
 * collisions before anything is created, then holds the per-skill
 * cross-process lock around this call. Both front ends therefore resolve the
 * default branch themselves — the step is presentation-bound (the CLI wraps it
 * in its own spinner and its own "Detecting default branch" line) and must not
 * be duplicated inside this phase.
 *
 * This module is not presentation-free yet: the install-time spinner comes
 * from `cli/progress.js` (`withSpinner`), which the caller cannot inject —
 * swapping it for `io.progress` would change the CLI's output, so it is kept
 * exactly as the inline flow had it.
 */

/** Parameters of the filesystem-mutating install phase. */
export interface GitInstallParams {
  /** Spec as the caller gave it; recorded verbatim as the entry's `url`. */
  spec: string
  gitSpec: GitSpec
  /** Validated repo-relative skill root, or undefined for the clone root. */
  subdir: string | undefined
  /** Entry name, already sanitized. */
  skillName: string
  /** Directory name under <repos>/ — already sanitized and uniqueness-checked. */
  path: string
  /** The caller's explicit --name, when it passed one (may be undefined). */
  name: string | undefined
  /** Last path segment of `subdir`, when there is one. */
  subdirLeaf: string | undefined
  /** Skip the large-collection confirmation. */
  yes: boolean | undefined
  io: OpsIO
}

export interface GitInstallResult {
  /**
   * Which of the three outcomes the inline flow used to report through
   * `AddResult` this run produced:
   *
   *   - `installed` — the entry was registered and its links created; `entry`,
   *     `links` and `normalized` are populated.
   *   - `skipped` — the clone was removed and nothing was registered because a
   *     confirmation was declined (the DSH-plugin wrapper, or the
   *     large-collection guard): the two former `{ status: 'skipped' }` paths.
   *   - `failed` — the clone was removed and nothing was registered (the
   *     `--subdir` is not a real directory, the repo is neither a SKILL.md repo
   *     nor a DSH plugin, or it yields zero installable skills): the former
   *     `{ status: 'failed' }` paths.
   *
   * A clone or network error still throws, exactly as it always has.
   */
  status: 'installed' | 'skipped' | 'failed'
  /**
   * Why a `failed` / `skipped` run stopped — one code per return site, and
   * exactly the five codes the panel's former `installGitCore` answered with
   * (the CLI ignores this and keeps its own stderr wording). Never set on
   * `installed`.
   *
   * It lives on the result because the status alone cannot express it: the
   * panel maps each code to its own `error` payload, and collapsing them into
   * one would silently change what the panel reports.
   */
  code?: GitInstallFailCode
  /** Registered entry; only present when `status === 'installed'`. */
  entry?: SkillEntry
  /** Link names created in the official skills root, in creation order. */
  links: string[]
  /** Frontmatter fields the install-time normalization rewrote. */
  normalized: number
  clone: CloneResult
}

/**
 * The five stop reasons of a non-`installed` run (§10.4 dialect). Each is a
 * former `installGitCore` 400 in `src/http/routes.ts`; `dsh-plugin-repo` and
 * `aborted` are unreachable behind the panel's OpsIO (`jobIO.confirm` always
 * raises `NeedsConfirm` instead of answering "no") but stay in the union so the
 * route can keep its documented mapping.
 */
export type GitInstallFailCode =
  | 'subdir-not-found'
  | 'dsh-plugin-repo'
  | 'no-skill-md'
  | 'no-installable-skills'
  | 'aborted'

/**
 * The filesystem-mutating phase of `add` — clone → classify → normalize →
 * register → link — run under the per-skill cross-process lock (§7.3 layer 3).
 * Body unchanged from the former inline flow; the read-only preflight (subdir
 * validation, default-branch detect, re-registration and collision checks)
 * stays with the caller.
 */
export async function installFromGit(params: GitInstallParams): Promise<GitInstallResult> {
  const { spec, gitSpec, subdir: normalizedSubdir, path, skillName, name, subdirLeaf, yes, io } = params
  const dest = repoDir(path)
  await mkdir(dest, { recursive: true })
  // Remove the empty dir we just created so clone can work
  await rm(dest, { recursive: true, force: true })

  io.emit(`Cloning ${gitSpec.url} (ref: ${gitSpec.ref}) → ${dest}\n`)
  let clone: CloneResult
  try {
    clone = await withSpinner(`cloning (${gitSpec.ref})`, () =>
      cloneRepo(gitSpec, dest, { subdir: normalizedSubdir }),
    )
  } catch (err) {
    // Clean up any partially-created directory so a retry starts clean.
    await rm(dest, { recursive: true, force: true })
    throw err
  }

  // Say how much of the repository actually landed on disk: a larger clone than
  // the user asked for must never be a silent surprise.
  if (normalizedSubdir !== undefined) {
    io.emit(
      clone.mode === 'sparse'
        ? `  checkout: sparse — only this subdir is materialized\n`
        : `  checkout: full — the whole repository is materialized\n`,
    )
  }
  for (const warning of clone.warnings) {
    io.emit(`  ⚠ ${warning}\n`)
  }

  // Record the exact commit we installed — the "lockfile-lite".
  let commit: string | undefined
  try {
    commit = await getHeadCommit(dest)
  } catch {
    commit = undefined
  }

  // With `--subdir`, the skill root is the subdirectory; the clone root still
  // owns the git state (HEAD, pull) and the DSH plugin markers.
  const skillRoot = normalizedSubdir ? join(dest, normalizedSubdir) : dest
  if (normalizedSubdir) {
    // Must be a real directory: Git can check out a committed symlink at this
    // path, and following it would point the catalog outside the clone.
    if (!(await isRealDirectory(skillRoot))) {
      process.stderr.write(
        `Subdirectory "${normalizedSubdir}" does not exist as a real directory in the cloned repository.\n`,
      )
      await rm(dest, { recursive: true, force: true })
      return { status: 'failed', code: 'subdir-not-found', links: [], normalized: 0, clone }
    }
  }

  // Inspect the cloned repo before registering it.
  const repoKind = await classifyRepo(skillRoot, { markerDir: dest })

  if (repoKind.kind === 'dsh-plugin') {
    io.emit(
      `\nThis repository appears to be a DSH plugin rather than a SKILL.md repo.\n` +
      `It is not recommended to manage it with dsh-skills-nexus.\n` +
      `Please install it using that repository's own instructions, for example:\n` +
      `  dsh plugin --profile <name> add "${spec}"\n`,
    )
    await rm(dest, { recursive: true, force: true })
    return { status: 'skipped', code: 'dsh-plugin-repo', links: [], normalized: 0, clone }
  }

  if (repoKind.kind === 'unknown') {
    process.stderr.write(
      `\nNo SKILL.md file and no DSH plugin marker were found in this repository.\n` +
      `dsh-skills-nexus can only manage SKILL.md repositories.\n` +
      (await nestedHint(dest)),
    )
    await rm(dest, { recursive: true, force: true })
    return { status: 'failed', code: 'no-skill-md', links: [], normalized: 0, clone }
  }

  // SKILL.md + DSH 薄包装层：询问是否忽略包装层、按普通 SKILL.md 仓库管理。
  if (repoKind.kind === 'wrapped-skill') {
    const proceed = yes || await confirmOrCleanUp(
      io,
      `This repo has both SKILL.md and a DSH plugin wrapper (${repoKind.markers.join(', ')}).\n` +
      `Install as a plain SKILL.md repo via nexus? (y = ignore wrapper, n = abort and use dsh plugin add)`,
      dest,
    )
    if (!proceed) {
      io.emit(
        `Aborted. This repo has a DSH plugin wrapper — consider installing it as a plugin instead:\n` +
        `  dsh plugin --profile <name> add "${spec}"\n`,
      )
      await rm(dest, { recursive: true, force: true })
      return { status: 'skipped', code: 'aborted', links: [], normalized: 0, clone }
    }
  }

  // Preview with the full skill rules.
  const preview = await previewSkills(skillRoot)
  if (preview.length === 0) {
    process.stderr.write(
      `\nNo installable SKILL.md content was found at "${normalizedSubdir ?? 'the repository root'}".\n` +
      `dsh-skills-nexus can only install files that qualify as skills.\n` +
      (await nestedHint(dest)),
    )
    await rm(dest, { recursive: true, force: true })
    return { status: 'failed', code: 'no-installable-skills', links: [], normalized: 0, clone }
  }

  // Guard against accidental full installs of large collections.
  if (preview.length > LARGE_COLLECTION_THRESHOLD && !normalizedSubdir && !yes) {
    const proceed = await confirmOrCleanUp(
      io,
      `This repository yields ${preview.length} skills.\n` +
      `Do you want to install all of them? (Use --subdir <path> to install a single subdirectory instead.)`,
      dest,
    )
    if (!proceed) {
      io.emit(`Aborted.\n`)
      await rm(dest, { recursive: true, force: true })
      return { status: 'skipped', code: 'aborted', links: [], normalized: 0, clone }
    }
  }

  // --- Normalize frontmatter for every discovered skill ---
  //
  // The official filesystem provider silently skips skills with invalid names
  // or missing descriptions, so we fix both at install time.
  let normalizedCount = 0
  for (const s of preview) {
    const validName = s.invalidName ? sanitizeName(s.invalidName) : (s.name || skillName)

    if (s.invalidName) {
      await normalizeSkillName(s.skillFile, validName)
      io.emit(
        `  ⚠ frontmatter name "${s.invalidName}" is not valid kebab-case ` +
        `— normalized to "${validName}"\n`,
      )
      normalizedCount++
    }

    if (!s.description || s.description.trim().length === 0) {
      await ensureDescription(s.skillFile, validName)
      io.emit(
        `  ⚠ frontmatter description was missing — added fallback: "${validName}"\n`,
      )
      normalizedCount++
    }
  }

  const entry = {
    name: skillName,
    url: spec,
    gitUrl: gitSpec.url,
    ref: gitSpec.ref,
    commit,
    subdir: normalizedSubdir,
    path,
    addedAt: new Date().toISOString(),
  }

  await addEntry(entry)
  await mkdir(REPOS_DIR, { recursive: true })

  // Create symlinks in the official skills root for every discovered skill.
  // For single-skill repos: one symlink named after the entry.
  // For multi-skill repos: one symlink per discovered skill, named by frontmatter.
  let linkedCount = 0
  const links: string[] = []
  for (const s of preview) {
    const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name
    const linkName = preview.length === 1 ? skillName : (fmName || skillName)
    try {
      await linkSkill(linkName, s.resourceBase)
      linkedCount++
      links.push(linkName)
    } catch (err) {
      process.stderr.write(
        `  ⚠ failed to create symlink for "${linkName}": ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }

  // A `--name` that only repeats the default is worth one plain hint — it is
  // not an error, and leaving the option out changes nothing.
  const nameHint =
    name !== undefined && subdirLeaf !== undefined && sanitizeName(name) === subdirLeaf
      ? `  提示：--name 与默认条目名 "${subdirLeaf}" 相同，可省略。\n`
      : ''

  io.emit(
    `Added skill "${skillName}" from ${spec}\n` +
      (normalizedSubdir ? `  subdir: ${normalizedSubdir}\n` : '') +
      `  repo dir: ${dest}\n` +
      `  symlinks: ${linkedCount} skill(s) linked to ~/.dsh/skills/\n` +
      (normalizedCount > 0 ? `  normalized: ${normalizedCount} frontmatter field(s)\n` : '') +
      `  The skill(s) will appear in the DSH catalog on next reload.\n` +
      nameHint,
  )
  return { status: 'installed', entry, links, normalized: normalizedCount, clone }
}

/** Repos with > this many skills trigger the "install all?" guard (unless --subdir/--yes). */
export const LARGE_COLLECTION_THRESHOLD = 20

/**
 * `io.confirm` for the two guards that run *after* the clone landed: a front
 * end whose confirm never answers "no" but *raises* instead — the panel's
 * `jobIO` raises `NeedsConfirm` for every question, and a cancelled job raises
 * `JobCancelledError` — must still leave the filesystem as it found it. Without
 * this the partially-created clone survived, so nothing was registered while
 * `repos/<path>` stayed behind and the retry hit "directory already in use".
 *
 * The answer itself is returned untouched, so both CLI paths (`false` from a
 * non-TTY prompt, `true` from `--yes`) behave exactly as before.
 */
async function confirmOrCleanUp(io: OpsIO, question: string, dest: string): Promise<boolean> {
  try {
    return await io.confirm(question, false)
  } catch (err) {
    await rm(dest, { recursive: true, force: true })
    throw err
  }
}

/**
 * Hint for nested collection repos: if any direct subdirectory of the clone
 * root contains skill files, `--subdir` is the way to install them.
 */
async function nestedHint(dest: string): Promise<string> {
  return (await hasNestedSkills(dest))
    ? `\nIts SKILL.md files appear to live under subdirectories — install a specific one with:\n` +
      `  dsh-skills-nexus add <repo> --subdir <path>\n`
    : ''
}

/** True if any direct subdirectory of `dir` yields skill files (single-level). */
async function hasNestedSkills(dir: string): Promise<boolean> {
  let entries: Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const located = await locateSkillFiles(join(dir, entry.name))
    if (located.length > 0) return true
  }
  return false
}

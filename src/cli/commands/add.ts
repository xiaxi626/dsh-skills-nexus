import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { addEntry, hasEntry, readManifest } from '../../manifest.js'
import { SKILLS_DIR, skillDir } from '../../paths.js'
import {
  cloneRepo,
  getDefaultBranch,
  getHeadCommit,
  parseGitSpec,
  repoSlug,
  sanitizeName,
} from '../../git.js'
import { classifyRepo } from '../../repo-kind.js'
import { locateSkillFiles } from '../../locator.js'
import { previewSkills } from '../../resolve.js'
import { parseAddArgs } from '../args.js'

/**
 * `add` — clone a GitHub SKILL.md repo and register it in the manifest.
 *
 * The repo lands under <skills>/<path>/; the manifest stores how to re-fetch it
 * so `update` can fast-forward later. The skill is enabled by default.
 *
 * When the user does not specify a `#ref`, we detect the remote's default
 * branch via `git ls-remote --symref` instead of hardcoding `main`.
 *
 * `--subdir <path>` installs a single subdirectory of the clone (collection
 * repos like `trae-skills`): the subdir becomes the skill root, the entry gets
 * a `subdir` field, and the clone directory is dedicated to that entry
 * (independent-clone design — see docs/subdir-design.md).
 *
 * Before registering, the clone is *previewed* with the full skill rules, so
 * repos that yield zero installable skills (docs-only roots, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export async function add(argv: string[]): Promise<number> {
  const { spec, name, ref, subdir, yes } = parseAddArgs(argv)

  // Parse once to get the URL; we'll refine the ref below if needed.
  let gitSpec = parseGitSpec(spec, ref ?? 'main')

  // If user didn't pin a ref, detect the remote's default branch.
  if (!ref && !spec.includes('#')) {
    process.stdout.write(`Detecting default branch for ${gitSpec.url}…\n`)
    const detected = await getDefaultBranch(gitSpec.url)
    if (detected !== gitSpec.ref) {
      process.stdout.write(`  → using ${detected} (detected)\n`)
    }
    gitSpec = { ...gitSpec, ref: detected }
  }

  // `--subdir` must be a repo-relative path: no absolute paths, no `..`.
  if (
    subdir &&
    (/^[\\/]/.test(subdir) || subdir.split(/[\\/]/).includes('..'))
  ) {
    process.stderr.write(
      `Invalid --subdir "${subdir}": must be a repo-relative path (no leading "/", no "..").\n`,
    )
    return 1
  }

  const repoBase = sanitizeName(repoSlug(gitSpec))
  const subdirLeaf = subdir
    ? sanitizeName(subdir.split(/[\\/]/).filter(Boolean).pop() ?? 'skill')
    : undefined
  const path = subdir ? `${repoBase}-${subdirLeaf}` : repoBase
  const skillName = sanitizeName(name ?? subdirLeaf ?? repoBase)

  // Reject re-registration *before* touching the filesystem: cloning into an
  // existing registered path would fail, and the failure cleanup below would
  // delete the already-registered skill's clone.
  const manifest = await readManifest()
  if (hasEntry(manifest, skillName) || manifest.skills.some((s) => s.path === path)) {
    process.stderr.write(
      `A skill named "${skillName}" is already registered (path "${path}").\n` +
      `Use "dsh-skills-nexus update ${skillName}" to refresh it, or "dsh-skills-nexus remove ${skillName}" first.\n`,
    )
    return 1
  }

  const dest = skillDir(path)
  await mkdir(dirname(dest), { recursive: true })

  process.stdout.write(`Cloning ${gitSpec.url} (ref: ${gitSpec.ref}) → ${dest}\n`)
  try {
    await cloneRepo(gitSpec, dest)
  } catch (err) {
    // Clean up any partially-created directory so a retry starts clean.
    await rm(dest, { recursive: true, force: true })
    throw err
  }

  // Record the exact commit we installed — the "lockfile-lite" half of version
  // management: even when `ref` is a moving branch, the manifest knows the
  // precise state. Non-fatal: a git hiccup here must not block registration.
  let commit: string | undefined
  try {
    commit = await getHeadCommit(dest)
  } catch {
    commit = undefined
  }

  // With `--subdir`, the skill root is the subdirectory; the clone root still
  // owns the git state (HEAD, pull) and the DSH plugin markers.
  const skillRoot = subdir ? join(dest, subdir) : dest
  if (subdir) {
    let st
    try {
      st = await stat(skillRoot)
    } catch {
      st = undefined
    }
    if (!st?.isDirectory()) {
      process.stderr.write(
        `Subdirectory "${subdir}" does not exist in the cloned repository.\n`,
      )
      await rm(dest, { recursive: true, force: true })
      return 1
    }
  }

  // Inspect the cloned repo before registering it. This decides whether the
  // repo is a plain SKILL.md repo, a SKILL.md repo with a thin DSH plugin
  // wrapper, a pure DSH plugin, or something nexus cannot manage.
  const repoKind = await classifyRepo(skillRoot, { markerDir: dest })

  if (repoKind.kind === 'dsh-plugin') {
    process.stdout.write(
      `\nThis repository appears to be a DSH plugin rather than a SKILL.md repo.\n` +
      `It is not recommended to manage it with dsh-skills-nexus.\n` +
      `Please install it using that repository's own instructions, for example:\n` +
      `  dsh plugin --profile <name> add "${spec}"\n`,
    )
    await rm(dest, { recursive: true, force: true })
    return 0
  }

  if (repoKind.kind === 'unknown') {
    process.stderr.write(
      `\nNo SKILL.md file and no DSH plugin marker were found in this repository.\n` +
      `dsh-skills-nexus can only manage SKILL.md repositories.\n` +
      (await nestedHint(dest)),
    )
    await rm(dest, { recursive: true, force: true })
    return 1
  }

  if (repoKind.kind === 'wrapped-skill' && !yes) {
    const useNexus = await confirm(
      `This repository has both SKILL.md and a DSH plugin wrapper (${repoKind.markers.join(', ')}).\n` +
      `Do you want dsh-skills-nexus to ignore the wrapper and manage it as a plain SKILL.md repo?`,
      false,
    )
    if (!useNexus) {
      process.stdout.write(
        `Aborted. If you want to install it as a DSH plugin, follow that repository's instructions, e.g.\n` +
        `  dsh plugin --profile <name> add "${spec}"\n`,
      )
      await rm(dest, { recursive: true, force: true })
      return 0
    }
  }

  // Preview with the full skill rules (incl. the flat-md frontmatter filter).
  // Zero results means the root is docs-only — reject instead of
  // "fake-installing" a repo whose skills are all nested deeper.
  const preview = await previewSkills(skillRoot)
  if (preview.length === 0) {
    process.stderr.write(
      `\nNo installable SKILL.md content was found at "${subdir ?? 'the repository root'}".\n` +
      `dsh-skills-nexus can only install files that qualify as skills.\n` +
      (await nestedHint(dest)),
    )
    await rm(dest, { recursive: true, force: true })
    return 1
  }

  // Frontmatter names that DSH would reject are registered under the fallback
  // (entry) name — warn so the user knows the catalog name differs.
  for (const s of preview) {
    if (s.invalidName) {
      process.stdout.write(
        `  ⚠ frontmatter name "${s.invalidName}" is not a valid DSH skill name ` +
        `(lowercase kebab-case required) — registered as "${skillName}"\n`,
      )
    }
  }

  // Guard against accidental full installs of large collections. Explicit
  // `--subdir` installs skip this — the user already narrowed the scope.
  if (preview.length > LARGE_COLLECTION_THRESHOLD && !subdir && !yes) {
    const proceed = await confirm(
      `This repository yields ${preview.length} skills.\n` +
      `Do you want to install all of them? (Use --subdir <path> to install a single subdirectory instead.)`,
      false,
    )
    if (!proceed) {
      process.stdout.write(`Aborted.\n`)
      await rm(dest, { recursive: true, force: true })
      return 0
    }
  }

  const entry = {
    name: skillName,
    url: spec,
    gitUrl: gitSpec.url,
    ref: gitSpec.ref,
    commit,
    subdir,
    path,
    enabled: true,
    addedAt: new Date().toISOString(),
  }

  await addEntry(entry)
  await mkdir(SKILLS_DIR, { recursive: true })

  process.stdout.write(
    `Added skill "${skillName}" from ${spec}\n` +
      (subdir ? `  subdir: ${subdir}\n` : '') +
      `  dir: ${dest}\n` +
      `  Run a DSH profile (or reload) to make it appear in the catalog.\n`,
  )
  return 0
}

/** Repos with > this many skills trigger the "install all?" guard (unless --subdir/--yes). */
export const LARGE_COLLECTION_THRESHOLD = 20

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

/**
 * Ask a yes/no question on the terminal.
 *
 * If stdin is not a TTY, default to `defaultValue` instead of hanging. This
 * keeps automation from blocking forever while still allowing interactive use.
 */
async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
  if (!input.isTTY) return defaultValue

  const rl = createInterface({ input, output })
  try {
    const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] '
    const answer = (await rl.question(question + suffix)).trim().toLowerCase()
    if (answer === 'y' || answer === 'yes') return true
    if (answer === 'n' || answer === 'no') return false
    return defaultValue
  } finally {
    rl.close()
  }
}

import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { addEntry, hasEntry, readManifest } from '../../manifest.js'
import { REPOS_DIR, repoDir } from '../../paths.js'
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
import { normalizeSkillName, ensureDescription } from '../../frontmatter.js'
import { linkSkill, hasCollision } from '../../link.js'
import { parseAddArgs } from '../args.js'

/**
 * `add` — clone a GitHub SKILL.md repo and expose it via a symlink in the
 * official DSH skills root.
 *
 * The clone lands under <repos>/<path>/ and a symlink is created at
 * ~/.dsh/skills/<name>/ so the official filesystem provider discovers it
 * automatically. Multi-skill repos create one symlink per discovered skill.
 *
 * `--subdir <path>` installs a single subdirectory of the clone (collection
 * repos): the subdir is the skill root, the entry gets a `subdir` field, and
 * the clone directory is dedicated to that entry (independent-clone design).
 *
 * Before registering, the clone is *previewed* with the full skill rules, so
 * repos that yield zero installable skills are rejected.
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

  // Reject re-registration *before* touching the filesystem.
  const manifest = await readManifest()
  if (hasEntry(manifest, skillName) || manifest.skills.some((s) => s.path === path)) {
    process.stderr.write(
      `A skill named "${skillName}" is already registered (path "${path}").\n` +
      `Use "dsh-skills-nexus update ${skillName}" to refresh it, or "dsh-skills-nexus remove ${skillName}" first.\n`,
    )
    return 1
  }

  // Check for collisions with manually-placed skills in the official root.
  if (await hasCollision(skillName)) {
    process.stderr.write(
      `A directory/file named "${skillName}" already exists in ~/.dsh/skills/.\n` +
      `This appears to be manually placed (not a nexus symlink).\n` +
      `Please remove it first or use --name to choose a different name.\n`,
    )
    return 1
  }

  const dest = repoDir(path)
  await mkdir(dest, { recursive: true })
  // Remove the empty dir we just created so clone can work
  await rm(dest, { recursive: true, force: true })

  process.stdout.write(`Cloning ${gitSpec.url} (ref: ${gitSpec.ref}) → ${dest}\n`)
  try {
    await cloneRepo(gitSpec, dest)
  } catch (err) {
    // Clean up any partially-created directory so a retry starts clean.
    await rm(dest, { recursive: true, force: true })
    throw err
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

  // Inspect the cloned repo before registering it.
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

  // SKILL.md + DSH 薄包装层：询问是否忽略包装层、按普通 SKILL.md 仓库管理。
  if (repoKind.kind === 'wrapped-skill') {
    const proceed = yes || await confirm(
      `This repo has both SKILL.md and a DSH plugin wrapper (${repoKind.markers.join(', ')}).\n` +
      `Install as a plain SKILL.md repo via nexus? (y = ignore wrapper, n = abort and use dsh plugin add)`,
      false,
    )
    if (!proceed) {
      process.stdout.write(
        `Aborted. This repo has a DSH plugin wrapper — consider installing it as a plugin instead:\n` +
        `  dsh plugin --profile <name> add "${spec}"\n`,
      )
      await rm(dest, { recursive: true, force: true })
      return 0
    }
  }

  // Preview with the full skill rules.
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

  // Guard against accidental full installs of large collections.
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

  // --- Normalize frontmatter for every discovered skill ---
  //
  // The official filesystem provider silently skips skills with invalid names
  // or missing descriptions, so we fix both at install time.
  let normalizedCount = 0
  for (const s of preview) {
    const validName = s.invalidName ? sanitizeName(s.invalidName) : (s.name || skillName)

    if (s.invalidName) {
      await normalizeSkillName(s.skillFile, validName)
      process.stdout.write(
        `  ⚠ frontmatter name "${s.invalidName}" is not valid kebab-case ` +
        `— normalized to "${validName}"\n`,
      )
      normalizedCount++
    }

    if (!s.description || s.description.trim().length === 0) {
      await ensureDescription(s.skillFile, validName)
      process.stdout.write(
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
    subdir,
    path,
    addedAt: new Date().toISOString(),
  }

  await addEntry(entry)
  await mkdir(REPOS_DIR, { recursive: true })

  // Create symlinks in the official skills root for every discovered skill.
  // For single-skill repos: one symlink named after the entry.
  // For multi-skill repos: one symlink per discovered skill, named by frontmatter.
  let linkedCount = 0
  for (const s of preview) {
    const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name
    const linkName = preview.length === 1 ? skillName : (fmName || skillName)
    try {
      await linkSkill(linkName, s.resourceBase)
      linkedCount++
    } catch (err) {
      process.stderr.write(
        `  ⚠ failed to create symlink for "${linkName}": ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }

  process.stdout.write(
    `Added skill "${skillName}" from ${spec}\n` +
      (subdir ? `  subdir: ${subdir}\n` : '') +
      `  repo dir: ${dest}\n` +
      `  symlinks: ${linkedCount} skill(s) linked to ~/.dsh/skills/\n` +
      (normalizedCount > 0 ? `  normalized: ${normalizedCount} frontmatter field(s)\n` : '') +
      `  The skill(s) will appear in the DSH catalog on next reload.\n`,
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
 * If stdin is not a TTY, default to `defaultValue` instead of hanging.
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

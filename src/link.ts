import { symlink, lstat, unlink, mkdir, readlink, readdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { OFFICIAL_SKILLS_DIR, repoDir, skillLinkPath } from './paths.js'
import type { SkillEntry } from './types.js'

/**
 * Manage symlinks that expose cloned skills to the official DSH skills root.
 *
 * The official filesystem provider only scans one level deep under
 * `~/.dsh/skills/`, so nexus creates one symlink per discovered skill at the
 * top level. This way:
 *   - The official provider handles discovery, watching, and error tolerance.
 *   - Nexus still manages git clones, subdir installs, and collection repos.
 *   - enable/disable is just create/remove symlink — lightweight and atomic.
 */

/** True if a symlink (or directory) exists at the official skill path. */
export async function isLinked(skillName: string): Promise<boolean> {
  try {
    await lstat(skillLinkPath(skillName))
    return true
  } catch {
    return false
  }
}

/**
 * True when the entry is enabled — i.e. at least one symlink in the official
 * skills root points inside its clone.
 *
 * State is looked up by link *target*, not by name: multi-skill repos create
 * one symlink per discovered skill (named after each skill's frontmatter),
 * so no symlink ever carries the entry name. A name-based `isLinked(entry.name)`
 * reported such entries as disabled even while all of their skills were
 * linked — breaking `list`, the `disable` early-return, and the default
 * `update` target filter. Scanning targets works for single- and multi-skill
 * repos alike and does not require the clone to be present.
 */
export async function isEntryEnabled(entry: SkillEntry): Promise<boolean> {
  const base = resolve(repoDir(entry.path)) + sep
  let names: string[] = []
  try {
    names = await readdir(OFFICIAL_SKILLS_DIR)
  } catch {
    return false
  }
  for (const name of names) {
    const target = await readLinkTarget(name)
    if (target === undefined) continue
    const resolved = resolve(OFFICIAL_SKILLS_DIR, target)
    if (resolved === base.slice(0, -1) || resolved.startsWith(base)) return true
  }
  return false
}

/**
 * Create a symlink in the official skills root pointing to `targetDir`.
 *
 * If a symlink already exists at the same name it is replaced atomically
 * (unlink then symlink). Parent directories are created as needed.
 */
export async function linkSkill(skillName: string, targetDir: string): Promise<void> {
  await mkdir(OFFICIAL_SKILLS_DIR, { recursive: true })
  const linkPath = skillLinkPath(skillName)

  // Remove existing link/file if present
  try {
    const existing = await lstat(linkPath)
    if (existing.isSymbolicLink() || existing.isDirectory() || existing.isFile()) {
      await unlink(linkPath)
    }
  } catch {
    // doesn't exist — fine
  }

  await symlink(targetDir, linkPath, 'junction')
}

/** Remove a skill's symlink from the official skills root. */
export async function unlinkSkill(skillName: string): Promise<void> {
  const linkPath = skillLinkPath(skillName)
  try {
    const st = await lstat(linkPath)
    if (st.isSymbolicLink()) {
      await unlink(linkPath)
    }
  } catch {
    // not present — nothing to do
  }
}

/**
 * Resolve a skill symlink to its target path. Returns `undefined` if the
 * symlink does not exist or is not a symlink.
 */
export async function readLinkTarget(skillName: string): Promise<string | undefined> {
  const linkPath = skillLinkPath(skillName)
  try {
    const st = await lstat(linkPath)
    if (!st.isSymbolicLink()) return undefined
    return await readlink(linkPath)
  } catch {
    return undefined
  }
}

/** Check whether the official skills root has a non-symlink directory/file
 *  that would collide with a new skill name. Returns true if a collision
 *  exists (i.e. a real directory or file, not a nexus-managed symlink). */
export async function hasCollision(skillName: string): Promise<boolean> {
  const linkPath = skillLinkPath(skillName)
  try {
    const st = await lstat(linkPath)
    // If it's a symlink, we can safely replace it — it's either ours or stale.
    // If it's a real directory/file, the user probably put it there manually.
    return !st.isSymbolicLink()
  } catch {
    return false
  }
}

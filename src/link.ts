import { symlink, lstat, unlink, mkdir, readdir, rmdir, readlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { OFFICIAL_SKILLS_DIR, repoDir, resolveLinkTarget, skillLinkPath } from './paths.js'
import type { SkillEntry } from './types.js'

/**
 * Manage links that expose cloned skills to the official DSH skills root.
 *
 * The official filesystem provider only scans one level deep under
 * `~/.dsh/skills/`, so nexus creates one link per discovered skill at the top
 * level. This way:
 *   - The official provider handles discovery, watching, and error tolerance.
 *   - Nexus still manages git clones, subdir installs, and collection repos.
 *   - enable/disable is just create/remove link — lightweight and atomic.
 *
 * On Windows `linkSkill` creates an **NTFS junction**, because a real directory
 * symlink needs a privilege junctions do not. That single choice is why every
 * reader below goes through `resolveLinkTarget` (`realpath`) and every removal
 * through `removeLinkEntry` (`rmdir`): Node reports a junction as an ordinary
 * directory to `lstat`, refuses `readlink` on it with `EINVAL`, and refuses
 * `unlink` on it with `EPERM`. The former `lstat` + `readlink` + `unlink`
 * triple therefore made every junction invisible and undeletable, which showed
 * up as "an entry with three links reports itself disabled, and `disable`
 * silently removes nothing".
 */

/** True if a link (or directory) exists at the official skill path. */
export async function isLinked(skillName: string): Promise<boolean> {
  try {
    await lstat(skillLinkPath(skillName))
    return true
  } catch {
    return false
  }
}

/** One link that belongs to an entry: its name and resolved target path. */
export interface EntryLink {
  /** Link name under the official skills root. */
  name: string
  /** Absolute resolved target — inside the entry's clone (or one of its subdirs). */
  target: string
}

/**
 * Section 6.4 attribution predicate: `resolved` equals `base` or lies inside
 * it. Single source for link ownership — shared by `entryLinks` (list/state
 * derivation) and `unlinkIfPointsInto` (the attribution unlink), so both sides
 * judge ownership identically.
 */
function pointsInto(resolved: string, base: string): boolean {
  return resolved === base || resolved.startsWith(base + sep)
}

/**
 * Delete a link entry — a POSIX symlink or a Windows junction. Returns true
 * iff an entry was removed; false when there was nothing there, or when the
 * path is a real directory this function must not touch.
 *
 * The primitive matters on Windows: a junction is a *directory* carrying a
 * reparse point, so `unlink` fails with `EPERM` and `rm` refuses with
 * `ERR_FS_EISDIR` (it will not remove a non-empty directory and will not
 * follow the reparse point). `rmdir` is the one call that removes the link
 * itself without descending into what it points at — verified to leave the
 * target's contents untouched. A plain file in the same slot falls through to
 * `unlink`.
 *
 * A *dangling* junction is the case that makes this worth its own function:
 * `realpath` cannot resolve it and `lstat` reports it as a plain directory, so
 * neither a resolution test nor `rm -r` can see it — `rm -r` walks into the
 * reparse point, finds nothing, and fails with `ENOTEMPTY`, leaving the link
 * behind forever. `rmdir` removes it directly.
 *
 * The reverse case is equally deliberate: `rmdir` on a real directory fails,
 * and that failure is reported as `false` rather than escalated, because "this
 * is not a link" is the answer the caller needs — `linkSkill` fills such a
 * slot only when it is empty, and `unlinkSkill` leaves a populated one alone.
 */
async function removeLinkEntry(linkPath: string): Promise<boolean> {
  try {
    await rmdir(linkPath)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // Nothing there at all — the caller's goal is already met.
    if (code === 'ENOENT' && !(await existsAsEntry(linkPath))) return false
    // Everything else: a link `rmdir` refused for a reason of its own (a
    // dangling junction reports its own code per platform), a plain file, or a
    // non-empty real directory. `unlink` succeeds for the first two and refuses
    // the third, which is exactly the `false` the caller needs — "this is not
    // something I may remove".
  }
  return unlink(linkPath).then(
    () => true,
    () => false,
  )
}

/** True when something (file, directory, or link of any state) is at `path`. */
async function existsAsEntry(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** True when a POSIX symlink sits at `path` (false for anything else). */
async function isSymlinkAt(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * True when `path` is a link nexus could have created, rather than a real
 * directory or file the user placed there.
 *
 * Two independent proofs, because no single one covers both platforms:
 *   - it *resolves elsewhere* (`realpath`) — the normal case, and the only one
 *     that works for a Windows junction with a live target;
 *   - it is a POSIX symlink (`lstat`) — which is what a **dangling** symlink
 *     needs, since `realpath` cannot resolve it and `lstat` still reports the
 *     link bit.
 *
 * A dangling Windows junction satisfies neither: `realpath` fails and `lstat`
 * reports a plain directory. Only `rmdir` can identify that one, which is why
 * `removeLinkEntry` uses it as the removal primitive rather than as a test.
 */
async function isLinkEntry(path: string): Promise<boolean> {
  const target = await resolveLinkTarget(path)
  if (target !== undefined) return resolve(target) !== resolve(path)
  return isSymlinkAt(path)
}

/**
 * The directory a link points at — **including when that directory no longer
 * exists**.
 *
 * `resolveLinkTarget` (`realpath`) is the right answer whenever the target is
 * live, and the only reader that works for a Windows junction. For a *dangling*
 * POSIX symlink it is `undefined`, while `readlink` still knows the path — and
 * that is exactly the case link cleanup runs into: `remove` and `update` delete
 * a clone first and its links second, so by the time the links are visited their
 * target is already gone. Reading nothing there leaves them behind, which is
 * the "dangling link no later command can attribute" residue `update` exists to
 * prevent.
 *
 * Returns `undefined` when nothing can be recovered: absent, or a Windows
 * junction whose target was deleted (`realpath` and `readlink` both refuse such
 * a reparse point — see the module header).
 */
export async function readLinkEntryTarget(path: string): Promise<string | undefined> {
  const resolved = await resolveLinkTarget(path)
  if (resolved !== undefined) return resolved
  try {
    return resolve(dirname(path), await readlink(path))
  } catch {
    return undefined
  }
}

/** True when `path` is a link rather than a real directory or file. */
export async function isLinkAt(path: string): Promise<boolean> {
  return isLinkEntry(path)
}

/**
 * All links in the official skills root whose target resolves inside the
 * entry's clone (or one of its subdirs) — the entry-to-link one-to-many
 * relation (section 6.4).
 *
 * State is looked up by link *target*, not by name: multi-skill repos create
 * one link per discovered skill (named after each skill's frontmatter), so no
 * link ever carries the entry name. A name-based `isLinked(entry.name)`
 * reported such entries as disabled even while all of their skills were
 * linked — breaking `list`, the `disable` early-return, and the default
 * `update` target filter. Scanning targets works for single- and multi-skill
 * repos alike and does not require the clone to be present.
 */
export async function entryLinks(entry: SkillEntry): Promise<EntryLink[]> {
  const base = resolve(repoDir(entry.path))
  let names: string[] = []
  try {
    names = await readdir(OFFICIAL_SKILLS_DIR)
  } catch {
    return []
  }
  const links: EntryLink[] = []
  for (const name of names) {
    // `readLinkEntryTarget`, not `resolveLinkTarget`: a link whose target was
    // just deleted still belongs to this entry, and `update`/`remove` rely on
    // finding it to unlink it before the dangling link outlives the clone.
    const target = await readLinkEntryTarget(skillLinkPath(name))
    if (target === undefined) continue
    const resolved = resolve(target)
    if (pointsInto(resolved, base)) {
      links.push({ name, target: resolved })
    }
  }
  return links
}

/**
 * True when the entry is enabled — at least one link points into its clone.
 * Thin wrapper over `entryLinks`, the single target-ownership scanner.
 */
export async function isEntryEnabled(entry: SkillEntry): Promise<boolean> {
  return (await entryLinks(entry)).length > 0
}

/**
 * Create a link in the official skills root pointing to `targetDir`.
 *
 * On Windows this is an NTFS junction (`symlink(..., 'junction')`), which needs
 * no elevation — and which `resolveLinkTarget`, unlike `lstat`/`readlink`,
 * reports correctly. Every reader of a link in this module goes through it for
 * that reason.
 *
 * An existing entry at the same name is replaced: any link (ours or stale,
 * including a dangling one), and a plain file. A populated real directory is
 * left in place — `symlink` then fails with `EEXIST`, which is the honest
 * outcome, rather than deleting content the user put there.
 */
export async function linkSkill(skillName: string, targetDir: string): Promise<void> {
  await mkdir(OFFICIAL_SKILLS_DIR, { recursive: true })
  const linkPath = skillLinkPath(skillName)

  if (await isLinkEntry(linkPath)) await removeLinkEntry(linkPath)
  else if (await existsAsEntry(linkPath)) await removeLinkEntry(linkPath)

  await symlink(targetDir, linkPath, 'junction')
}

/**
 * Remove a skill's link from the official skills root.
 *
 * A real directory the user placed there is left alone: `isLinkEntry` only
 * reports true for a link (`realpath` resolves elsewhere) or for something
 * that resolves nowhere (a dangling link, which on Windows is a reparse point
 * `lstat` cannot see either).
 */
export async function unlinkSkill(skillName: string): Promise<void> {
  const linkPath = skillLinkPath(skillName)
  if (!(await isLinkEntry(linkPath))) return
  await removeLinkEntry(linkPath)
}

/**
 * Remove the link at `linkPath` when its resolved target lies inside `dir` (or
 * equals it) — the section 6.4 target-attribution unlink. Returns true iff a
 * link was removed; a missing path, a non-link, or a link owned by another
 * clone leaves the filesystem untouched. Attribution is judged by
 * `pointsInto`, the same predicate `entryLinks` uses, so "which links belong
 * to an entry" has one answer everywhere.
 *
 * The predicate is also the guard: a path that resolves into a clone is a link
 * nexus created, because a real directory a user placed in the skills root
 * resolves to itself and therefore lies outside `dir`.
 */
export async function unlinkIfPointsInto(linkPath: string, dir: string): Promise<boolean> {
  const target = await resolveLinkTarget(linkPath)
  if (target !== undefined) {
    if (!pointsInto(resolve(target), resolve(dir))) return false
  } else if (!(await isLinkEntry(linkPath))) {
    // Nothing there, or a real directory: neither is a link of ours.
    // (A link whose target is already gone resolves nowhere — the clone was
    // deleted first, which is exactly the order `remove` uses.)
    return false
  }
  return removeLinkEntry(linkPath)
}

/**
 * Resolve a skill link to the directory it exposes. Returns `undefined` if the
 * path does not exist or cannot be resolved (a dangling or cyclic link) — see
 * `resolveLinkTarget` for why this reads through `realpath` rather than
 * `readlink`.
 */
export async function readLinkTarget(skillName: string): Promise<string | undefined> {
  return resolveLinkTarget(skillLinkPath(skillName))
}

/** Check whether the official skills root has a non-link directory/file that
 *  would collide with a new skill name. Returns true if a collision exists
 *  (i.e. a real directory or file, not a nexus-managed link). */
export async function hasCollision(skillName: string): Promise<boolean> {
  const linkPath = skillLinkPath(skillName)
  // `isLinkEntry` is true for a link (ours or stale) and for a dangling one;
  // both are safe to replace. A real directory or file is a collision.
  if (!(await existsAsEntry(linkPath))) return false
  return !(await isLinkEntry(linkPath))
}

import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { isExternalEntry, removeEntry, removeSkillDir } from './manifest.js'
import { repoDir } from './paths.js'
import { isLinked, unlinkSkill } from './link.js'
import { previewSkills } from './resolve.js'
import { sanitizeName } from './git.js'
import { rollbackPath } from './rollback.js'

/**
 * Delete one skill by exact name — the single implementation behind both the
 * CLI `remove` command and the plugin's `POST /remove` route.
 *
 * Order and link-name derivation are the v0.3.0 behaviour, moved here
 * unchanged: unregister first, then walk the skills the clone currently yields
 * and delete the link each one would have been created under — `previewSkills`
 * names for a multi-skill repo, the entry name for a single-skill one, with the
 * entry name tried once more as a fallback — then delete the clone directory.
 *
 * Links are *derived by name*, not attributed by readlink target: a symlink
 * someone created by hand that happens to point into this clone is not removed
 * by this operation. That is the long-standing CLI contract, kept deliberately
 * so both faces of the operation behave identically; the residue such an alias
 * leaves behind is what `doctor`'s orphan-link check reports.
 */

export interface RemoveResult {
  /** False when no entry carries that name — nothing else was touched. */
  removed: boolean
  /** Link names actually unlinked; feeds the route's `links` + `hotReload`. */
  links: string[]
}

/**
 * Unregister the entry `name`, delete the links its skills are exposed under,
 * and remove its clone directory.
 *
 * @param name - registered entry name.
 * @returns whether an entry was removed, plus the links deleted with it.
 */
export async function removeSkill(name: string): Promise<RemoveResult> {
  const removed = await removeEntry(name)
  if (!removed) return { removed: false, links: [] }

  const dir = repoDir(removed.path)
  const skillRoot = removed.subdir ? join(dir, removed.subdir) : dir
  const links: string[] = []
  const unlink = async (linkName: string): Promise<void> => {
    if (await isLinked(linkName)) {
      await unlinkSkill(linkName)
      links.push(linkName)
    }
  }

  try {
    const skills = await previewSkills(skillRoot)
    for (const s of skills) {
      const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name
      await unlink(skills.length === 1 ? removed.name : (fmName || removed.name))
    }
    // Also try the entry name itself in case it's different.
    if (skills.length > 1) await unlink(removed.name)
  } catch {
    // Malformed frontmatter and friends: fall back to the entry name. A missing
    // clone does not land here — the locator yields an empty list instead.
    await unlink(removed.name)
  }

  // An external (`--link-only`) entry only links a directory the user owns:
  // unregister and unlink, but never delete that directory.
  if (isExternalEntry(removed)) return { removed: true, links }

  await removeSkillDir(removed.path)
  // The rollback JSON is keyed by entry name, not by clone path, so it
  // survives the clone deletion above. Clean it up here — a removed entry
  // has no use for its recovery point, and leaving it behind would leak
  // orphan files that accumulate over repeated add/remove cycles.
  await rm(rollbackPath(removed.name), { force: true }).catch(() => {})
  return { removed: true, links }
}

import { entryLinks, entryLinkCandidates, hasCollision, linkSkill, unlinkIfPointsInto } from './link.js'
import { entrySkillDir } from './external.js'
import { repoDir, skillLinkPath } from './paths.js'
import { previewSkills } from './resolve.js'
import { setEntryExcluded } from './manifest.js'
import type { SkillEntry } from './types.js'

/**
 * Per-skill enable/disable — the one core shared by the CLI (`toggle.ts`) and
 * the HTTP toggle route, so both surfaces record the same exclusion intent
 * and apply the same link semantics (§10.1 shared-core rule).
 *
 * `excluded` on the entry records *intent*, orthogonal to the link-derived
 * enabled state: disabling one skill of a multi-skill entry removes its link
 * (when present) and remembers the name so whole-entry enable, `update` and
 * `switch-version` rebuilds never resurrect it; enabling lifts the exclusion
 * and restores the link only while the entry itself is enabled — otherwise
 * the intent is recorded alone and the link follows the next whole enable.
 *
 * The caller holds the per-skill cross-process lock (CLI `withSkillFileLock`,
 * HTTP `lockedFor`); this core takes no lock itself, exactly like
 * `toggleEntryCore` on the HTTP side.
 */

/** Why a per-skill toggle refused; the front ends map it to their dialects. */
export type SkillToggleErrorCode = 'not-found' | 'single-skill' | 'collision'

export class SkillToggleError extends Error {
  constructor(
    public readonly code: SkillToggleErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SkillToggleError'
  }
}

export interface SkillToggleResult {
  /** Links created (enable) or removed (disable); intent-only runs report 0. */
  linksChanged: number
  /** True when neither the exclusion intent nor any link changed. */
  already: boolean
  /** Entry-level enabled state after the operation, derived from links. */
  enabled: boolean
}

export async function toggleEntrySkill(
  entry: SkillEntry,
  skillName: string,
  enabled: boolean,
): Promise<SkillToggleResult> {
  const skillRoot = entrySkillDir(entry)
  const skills = await previewSkills(skillRoot)
  // A single-skill entry IS its one skill — the whole-entry toggle already
  // covers it, and a per-skill exclusion would only desync intent from state.
  if (skills.length === 1) {
    throw new SkillToggleError(
      'single-skill',
      `Entry "${entry.name}" exposes a single skill; toggle the whole entry instead (drop --skill).`,
    )
  }
  const candidate = entryLinkCandidates(entry, skills).find((c) => c.name === skillName)
  if (candidate === undefined) {
    throw new SkillToggleError(
      'not-found',
      `No skill named "${skillName}" in entry "${entry.name}".`,
    )
  }

  const excluded = new Set(entry.excluded ?? [])
  const wasExcluded = excluded.has(skillName)
  const links = await entryLinks(entry)
  const entryEnabled = links.length > 0
  let linksChanged = 0

  if (enabled) {
    excluded.delete(skillName)
    await setEntryExcluded(entry.name, [...excluded])
    if (entryEnabled && !links.some((l) => l.name === skillName)) {
      if (await hasCollision(skillName)) {
        throw new SkillToggleError(
          'collision',
          `A directory/file named "${skillName}" already exists in ~/.dsh/skills/ — remove it first.`,
        )
      }
      await linkSkill(skillName, candidate.target)
      linksChanged = 1
    }
  } else {
    excluded.add(skillName)
    await setEntryExcluded(entry.name, [...excluded])
    // Attribution base mirrors toggleLinks: the externalDir for new-style
    // external entries, the clone root otherwise. Only a link pointing into
    // the entry goes — a same-named link elsewhere is not ours to remove.
    const dir = (entry.ownership === 'external' && entry.externalDir) ? skillRoot : repoDir(entry.path)
    if (await unlinkIfPointsInto(skillLinkPath(skillName), dir)) linksChanged = 1
  }

  const already = linksChanged === 0 && wasExcluded === !enabled
  const final = await entryLinks(entry)
  return { linksChanged, already, enabled: final.length > 0 }
}
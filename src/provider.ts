import { resolveAll, resolveByName } from './resolve.js'
import type { SkillCandidate, SkillDefinition, SkillProvider } from './types.js'

/**
 * The nexus skill provider — the "thin wrapper" that turns cloned SKILL.md
 * repos into DSH skills.
 *
 *   list()  → scans every cloned dir, returns one SkillCandidate per SKILL.md
 *   get()   → reads the chosen SKILL.md, returns its body as content
 *
 * `resourceBase` is built per skill and points at that skill's own directory, so
 * relative paths in the body (references/, scripts/, assets/) resolve against
 * the correct clone.
 */

export const PROVIDER_NAME = 'dsh-skills-nexus'

/**
 * Catalog rank. The official filesystem provider uses priorities 100–500 for
 * local roots; GitHub-sourced skills sit below user-local ones so a local
 * override always wins. Tunable via the manifest/entry if needed later.
 */
export const GITHUB_SKILL_RANK = 600

export const nexusProvider: SkillProvider = {
  name: PROVIDER_NAME,

  async list(): Promise<SkillCandidate[]> {
    const resolved = await resolveAll()
    return resolved.map((s) => ({
      name: s.name,
      description: s.description,
      invocation: {
        modelInvocable: s.modelInvocable,
        userInvocable: s.userInvocable,
      },
      provider: PROVIDER_NAME,
      source: 'github',
      resourceBase: { kind: 'directory', path: s.resourceBase },
      rank: GITHUB_SKILL_RANK,
      locator: s.skillFile,
    }))
  },

  async get(name: string): Promise<SkillDefinition> {
    const s = await resolveByName(name)
    if (!s) {
      throw new Error(`[dsh-skills-nexus] skill not found: ${name}`)
    }
    return {
      name: s.name,
      description: s.description,
      invocation: {
        modelInvocable: s.modelInvocable,
        userInvocable: s.userInvocable,
      },
      provider: PROVIDER_NAME,
      source: 'github',
      resourceBase: { kind: 'directory', path: s.resourceBase },
      content: s.body,
    }
  },
}

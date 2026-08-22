import { readFile } from 'node:fs/promises'
import { readManifest } from './manifest.js'
import { skillDir } from './paths.js'
import { locateSkillFiles } from './locator.js'
import { parseFrontmatter, flag } from './frontmatter.js'
import type { SkillEntry } from './types.js'

/**
 * Resolve manifest entries into concrete, parsed skills.
 *
 * One manifest entry (a cloned repo) may yield multiple skills — e.g. a repo
 * that bundles `<name>/SKILL.md` per subdirectory. The skill name is taken from
 * each file's frontmatter `name` (falling back to the entry name) so multi-skill
 * repos surface correctly in the catalog.
 */

export interface ResolvedSkill {
  entry: SkillEntry
  skillFile: string
  resourceBase: string
  name: string
  description: string
  body: string
  modelInvocable: boolean
  userInvocable: boolean
}

export async function resolveAll(): Promise<ResolvedSkill[]> {
  const manifest = await readManifest()
  const out: ResolvedSkill[] = []

  for (const entry of manifest.skills) {
    if (!entry.enabled) continue
    const dir = skillDir(entry.path)
    const located = await locateSkillFiles(dir)

    for (const loc of located) {
      let raw = ''
      try {
        raw = await readFile(loc.skillFile, 'utf8')
      } catch {
        // Unreadable file — skip rather than collapse the whole catalog.
        continue
      }

      const { frontmatter, description, body } = parseFrontmatter(raw)
      const fmName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
      const name = fmName || entry.name

      out.push({
        entry,
        skillFile: loc.skillFile,
        resourceBase: loc.resourceBase,
        name,
        description: description || name,
        body,
        modelInvocable: !flag(frontmatter, 'disable-model-invocation', false),
        userInvocable: flag(frontmatter, 'user-invocable', true),
      })
    }
  }

  return out
}

export async function resolveByName(name: string): Promise<ResolvedSkill | null> {
  const all = await resolveAll()
  return all.find((s) => s.name === name) ?? null
}

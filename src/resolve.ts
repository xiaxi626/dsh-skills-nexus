import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
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
 *
 * When an entry has a `subdir`, the skill root is that subdirectory inside the
 * clone — this is how collection repos are installed piecemeal (`--subdir`).
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

/** A parsed skill without the manifest entry — used by resolveAll and add-time preview. */
export interface ParsedSkill {
  skillFile: string
  resourceBase: string
  /** Frontmatter `name` (may be empty — callers fall back to an entry/root name). */
  name: string
  /** Frontmatter `description` (may be empty). */
  description: string
  body: string
  modelInvocable: boolean
  userInvocable: boolean
}

/** True for flat-markdown skills (`<root>/<name>.md`, not a SKILL.md file). */
function isFlatMd(skillFile: string): boolean {
  return basename(skillFile).toLowerCase() !== 'skill.md'
}

/**
 * Locate + parse every skill under `dir` with the full skill rules.
 *
 * Flat-markdown files without a frontmatter `name` AND without a `description`
 * are not skills — they are docs (e.g. `community-leaderboard.md` in a
 * collection repo) and are skipped here. `SKILL.md` files keep the
 * fallback-name behavior (they are authoritative skill files).
 */
async function parseDirSkills(dir: string): Promise<ParsedSkill[]> {
  const located = await locateSkillFiles(dir)
  const out: ParsedSkill[] = []

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

    if (isFlatMd(loc.skillFile) && !fmName && !description) continue

    out.push({
      skillFile: loc.skillFile,
      resourceBase: loc.resourceBase,
      name: fmName,
      description,
      body,
      modelInvocable: !flag(frontmatter, 'disable-model-invocation', false),
      userInvocable: flag(frontmatter, 'user-invocable', true),
    })
  }

  return out
}

export async function resolveAll(): Promise<ResolvedSkill[]> {
  const manifest = await readManifest()
  const out: ResolvedSkill[] = []

  for (const entry of manifest.skills) {
    if (!entry.enabled) continue
    const dir = entry.subdir
      ? join(skillDir(entry.path), entry.subdir)
      : skillDir(entry.path)

    for (const s of await parseDirSkills(dir)) {
      const name = s.name || entry.name
      out.push({
        entry,
        ...s,
        name,
        description: s.description || name,
      })
    }
  }

  return out
}

export async function resolveByName(name: string): Promise<ResolvedSkill | null> {
  const all = await resolveAll()
  return all.find((s) => s.name === name) ?? null
}

/**
 * Preview which skills a directory would yield under the full skill rules —
 * used by `add` before registering, so empty results (docs-only repos, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export async function previewSkills(dir: string): Promise<ParsedSkill[]> {
  return parseDirSkills(dir)
}

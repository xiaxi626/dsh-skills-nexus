import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { locateSkillFiles } from './locator.js'
import { parseFrontmatter, flag } from './frontmatter.js'

/**
 * Parse cloned repos into concrete, parsed skills.
 *
 * One cloned repo may yield multiple skills — e.g. a repo that bundles
 * `<name>/SKILL.md` per subdirectory. Used by `add` for preview and by
 * `update` for re-normalization.
 *
 * When an entry has a `subdir`, the skill root is that subdirectory inside
 * the clone — this is how collection repos are installed piecemeal (`--subdir`).
 */

/** A parsed skill without the manifest entry — used for add-time preview. */
export interface ParsedSkill {
  skillFile: string
  resourceBase: string
  /** Frontmatter `name` (may be empty — callers fall back to an entry/root name). */
  name: string
  /**
   * Set when the frontmatter `name` was present but violates DSH's skill-name
   * rules — the skill would be silently skipped by the official provider.
   * Kept so `add` can warn and normalize.
   */
  invalidName?: string
  /** Frontmatter `description` (may be empty). */
  description: string
  body: string
  modelInvocable: boolean
  userInvocable: boolean
}

/**
 * DSH skill name validation — matches the official `SKILL_NAME` regex:
 *   `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
 *
 * Lowercase letters and digits only, separated by single dashes.
 * No dots, underscores, or consecutive dashes. An invalid frontmatter name
 * causes the official filesystem provider to silently skip that skill, so
 * nexus normalizes such names at install time and warns the user.
 */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
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

    // A frontmatter name that the official provider would reject must not
    // reach the filesystem. Normalize it at install time.
    let name = fmName
    let invalidName: string | undefined
    if (fmName && !isValidSkillName(fmName)) {
      invalidName = fmName
      name = ''
    }

    if (isFlatMd(loc.skillFile) && !name && !description) continue

    out.push({
      skillFile: loc.skillFile,
      resourceBase: loc.resourceBase,
      name,
      invalidName,
      description,
      body,
      modelInvocable: !flag(frontmatter, 'disable-model-invocation', false),
      userInvocable: flag(frontmatter, 'user-invocable', true),
    })
  }

  return out
}

/**
 * Preview which skills a directory would yield under the full skill rules —
 * used by `add` before registering, so empty results (docs-only repos, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export async function previewSkills(dir: string): Promise<ParsedSkill[]> {
  return parseDirSkills(dir)
}

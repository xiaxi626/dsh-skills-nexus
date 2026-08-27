import { readFile, writeFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

/**
 * Parse a SKILL.md document into its YAML frontmatter + Markdown body.
 *
 * The official `@deepseek-ai/dsh-skill-filesystem` parses frontmatter with the
 * `yaml` package into an open object; we do the same. This robustly handles
 * block scalars (`>` folded, `|` literal) that simple regex-based parsers
 * would have to special-case.
 */

export interface ParsedSkill {
  frontmatter: Record<string, unknown>
  description: string
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseFrontmatter(raw: string): ParsedSkill {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    // No frontmatter block — treat the whole file as body.
    return { frontmatter: {}, description: '', body: raw }
  }

  const frontmatterRaw = match[1] ?? ''
  const body = match[2] ?? ''

  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(frontmatterRaw)
    frontmatter = parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    // Malformed YAML — degrade gracefully so one bad file never collapses the
    // whole skill catalog.
    frontmatter = {}
  }

  const desc = frontmatter.description
  const description =
    typeof desc === 'string' ? desc.trim() : ''

  return { frontmatter, description, body }
}

/**
 * Read an optional boolean flag from frontmatter with a fallback.
 * Used for `disable-model-invocation` / `user-invocable` style toggles.
 */
export function flag(frontmatter: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = frontmatter[key]
  return typeof v === 'boolean' ? v : fallback
}

/* ------------------------------------------------------------------ */
/* Frontmatter normalization — install-time rewrites                   */
/* ------------------------------------------------------------------ */

/**
 * Rewrite the frontmatter `name` field in a SKILL.md file to a valid
 * kebab-case name. Only touches the `name:` line — body and other fields
 * are preserved.
 *
 * Called at install/update time so the official filesystem provider can
 * discover the skill (it silently skips skills with invalid names).
 */
export async function normalizeSkillName(
  skillFile: string,
  validName: string,
): Promise<void> {
  const raw = await readFile(skillFile, 'utf8')
  const fixed = raw.replace(
    /^(\s*name:\s*)[^\n\r]*/m,
    `$1${validName}`,
  )
  await writeFile(skillFile, fixed, 'utf8')
}

/**
 * Ensure the frontmatter has a non-empty `description` field. If missing or
 * empty, insert it with `fallback` as the value.
 *
 * The official provider silently skips skills without a description, so we
 * make sure every installed skill has one.
 */
export async function ensureDescription(
  skillFile: string,
  fallback: string,
): Promise<void> {
  const raw = await readFile(skillFile, 'utf8')
  const { frontmatter, description } = parseFrontmatter(raw)

  if (description && description.trim().length > 0) return

  // No description — add it after the `name:` line (or at the top of frontmatter).
  const hasName = typeof frontmatter.name === 'string'
  if (hasName) {
    const fixed = raw.replace(
      /^(\s*name:\s*[^\n\r]*\n)/m,
      `$1description: ${JSON.stringify(fallback)}\n`,
    )
    await writeFile(skillFile, fixed, 'utf8')
  } else {
    // No name either — prepend description at the start of frontmatter.
    const fixed = raw.replace(
      /^---\r?\n/m,
      `---\ndescription: ${JSON.stringify(fallback)}\n`,
    )
    await writeFile(skillFile, fixed, 'utf8')
  }
}

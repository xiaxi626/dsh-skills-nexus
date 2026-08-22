import { parse as parseYaml } from 'yaml'

/**
 * Parse a SKILL.md document into its YAML frontmatter + Markdown body.
 *
 * The official `@deepseek-ai/dsh-skill-filesystem` parses frontmatter with the
 * `yaml` package into an open object; we do the same. This robustly handles
 * block scalars (`>` folded, `|` literal) that simple regex-based parsers
 * would have to special-case.
 *
 * Only `description` and `body` are consumed by the provider; the full
 * frontmatter object is returned for the resolver to read `name` / `whenToUse`
 * / invocation flags.
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

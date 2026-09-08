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

  // Confine every rewrite to the frontmatter region: a column-0 `name:` or
  // `description:` line inside the Markdown body (e.g. a YAML sample in a
  // fenced code block) must never be mistaken for a frontmatter key.
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return
  const fmRaw = match[1] ?? ''
  const fmStart = raw.indexOf('\n') + 1
  const head = raw.slice(0, fmStart)
  const tail = raw.slice(fmStart + fmRaw.length)

  // Match the file's own line ending so a CRLF checkout never turns into a
  // mixed-EOL file.
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const line = `description: ${JSON.stringify(fallback)}`
  const hasName = typeof frontmatter.name === 'string'

  let fm: string
  const descKeyRe = /^description:[^\n\r]*/m
  if (descKeyRe.test(fmRaw)) {
    // A top-level `description:` key already exists but is empty — fill it in
    // place. Inserting a second one makes yaml.parse throw "Map keys must be
    // unique", which degrades the whole frontmatter to {}.
    fm = fmRaw.replace(descKeyRe, () => line)
  } else if (hasName) {
    // Insert right after the `name:` value. The pattern deliberately omits a
    // trailing newline (fmRaw's last line has none — it lives in the closing
    // fence) and prepends `eol` to the inserted line instead. The post-colon
    // `\s*` is kept on purpose: `\s` includes newlines, which is what lets a
    // multi-line plain scalar (`name:\n  My Skill`) be captured whole.
    fm = fmRaw.replace(
      /^(\s*name:\s*[^\n\r]*)/m,
      (_m: string, nameLine: string) => `${nameLine}${eol}${line}`,
    )
  } else {
    // No `name:` key — prepend at the top of the frontmatter block.
    fm = `${line}${eol}${fmRaw}`
  }

  if (fm === fmRaw) return
  await writeFile(skillFile, `${head}${fm}${tail}`, 'utf8')
}

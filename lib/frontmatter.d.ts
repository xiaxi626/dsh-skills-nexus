/**
 * Parse a SKILL.md document into its YAML frontmatter + Markdown body.
 *
 * The official `@deepseek-ai/dsh-skill-filesystem` parses frontmatter with the
 * `yaml` package into an open object; we do the same. This robustly handles
 * block scalars (`>` folded, `|` literal) that simple regex-based parsers
 * would have to special-case.
 */
export interface ParsedSkill {
    frontmatter: Record<string, unknown>;
    description: string;
    body: string;
}
export declare function parseFrontmatter(raw: string): ParsedSkill;
/**
 * Read an optional boolean flag from frontmatter with a fallback.
 * Used for `disable-model-invocation` / `user-invocable` style toggles.
 */
export declare function flag(frontmatter: Record<string, unknown>, key: string, fallback: boolean): boolean;
/**
 * Rewrite the frontmatter `name` field in a SKILL.md file to a valid
 * kebab-case name. Only touches the `name:` line — body and other fields
 * are preserved.
 *
 * Called at install/update time so the official filesystem provider can
 * discover the skill (it silently skips skills with invalid names).
 */
export declare function normalizeSkillName(skillFile: string, validName: string): Promise<void>;
/**
 * Ensure the frontmatter has a non-empty `description` field. If missing or
 * empty, insert it with `fallback` as the value.
 *
 * The official provider silently skips skills without a description, so we
 * make sure every installed skill has one.
 */
export declare function ensureDescription(skillFile: string, fallback: string): Promise<void>;
//# sourceMappingURL=frontmatter.d.ts.map
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
//# sourceMappingURL=frontmatter.d.ts.map
/**
 * Minimal glob matcher for `remove` name patterns — keeps the CLI
 * dependency-free (no `glob` / `minimatch`).
 *
 * Skill names are sanitized kebab-case (`[a-z0-9-]`), so only the two most
 * common shell metacharacters are supported:
 *   `*` — matches any run of characters (including none)
 *   `?` — matches exactly one character
 * The rarer `[abc]` character-class form is intentionally NOT supported: it
 * adds escaping complexity for no realistic gain on flat kebab-case names.
 */
/** True if `pattern` contains a glob metacharacter (`*` or `?`). */
export declare function hasMeta(pattern: string): boolean;
/**
 * Translate a `*`/`?` glob into an anchored RegExp. Every other regex-special
 * character is escaped so it matches literally. `*` and `?` are deliberately
 * left out of the escape set and translated afterwards.
 */
export declare function globToRegExp(pattern: string): RegExp;
/**
 * Return the subset of `names` matched by `pattern`.
 *
 * A pattern without any metacharacter is treated as an exact name (matched by
 * equality, not by regex), so a literal name never accidentally behaves like a
 * glob. An empty result is a valid outcome — the caller decides whether "no
 * match" is an error (remove.ts treats it as a per-item failure).
 */
export declare function matchNames(names: string[], pattern: string): string[];
//# sourceMappingURL=glob.d.ts.map
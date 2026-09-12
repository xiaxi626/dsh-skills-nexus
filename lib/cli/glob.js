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
export function hasMeta(pattern) {
    return /[*?]/.test(pattern);
}
/**
 * Translate a `*`/`?` glob into an anchored RegExp. Every other regex-special
 * character is escaped so it matches literally. `*` and `?` are deliberately
 * left out of the escape set and translated afterwards.
 */
export function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const body = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${body}$`);
}
/**
 * Return the subset of `names` matched by `pattern`.
 *
 * A pattern without any metacharacter is treated as an exact name (matched by
 * equality, not by regex), so a literal name never accidentally behaves like a
 * glob. An empty result is a valid outcome — the caller decides whether "no
 * match" is an error (remove.ts treats it as a per-item failure).
 */
export function matchNames(names, pattern) {
    if (!hasMeta(pattern)) {
        return names.filter((n) => n === pattern);
    }
    const re = globToRegExp(pattern);
    return names.filter((n) => re.test(n));
}
//# sourceMappingURL=glob.js.map
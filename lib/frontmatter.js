import { parse as parseYaml } from 'yaml';
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
export function parseFrontmatter(raw) {
    const match = raw.match(FRONTMATTER_RE);
    if (!match) {
        // No frontmatter block — treat the whole file as body.
        return { frontmatter: {}, description: '', body: raw };
    }
    const frontmatterRaw = match[1] ?? '';
    const body = match[2] ?? '';
    let frontmatter = {};
    try {
        const parsed = parseYaml(frontmatterRaw);
        frontmatter = parsed && typeof parsed === 'object'
            ? parsed
            : {};
    }
    catch {
        // Malformed YAML — degrade gracefully so one bad file never collapses the
        // whole skill catalog.
        frontmatter = {};
    }
    const desc = frontmatter.description;
    const description = typeof desc === 'string' ? desc.trim() : '';
    return { frontmatter, description, body };
}
/**
 * Read an optional boolean flag from frontmatter with a fallback.
 * Used for `disable-model-invocation` / `user-invocable` style toggles.
 */
export function flag(frontmatter, key, fallback) {
    const v = frontmatter[key];
    return typeof v === 'boolean' ? v : fallback;
}
//# sourceMappingURL=frontmatter.js.map
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readManifest } from './manifest.js';
import { skillDir } from './paths.js';
import { locateSkillFiles } from './locator.js';
import { parseFrontmatter, flag } from './frontmatter.js';
/** True for flat-markdown skills (`<root>/<name>.md`, not a SKILL.md file). */
function isFlatMd(skillFile) {
    return basename(skillFile).toLowerCase() !== 'skill.md';
}
/**
 * Locate + parse every skill under `dir` with the full skill rules.
 *
 * Flat-markdown files without a frontmatter `name` AND without a `description`
 * are not skills — they are docs (e.g. `community-leaderboard.md` in a
 * collection repo) and are skipped here. `SKILL.md` files keep the
 * fallback-name behavior (they are authoritative skill files).
 */
async function parseDirSkills(dir) {
    const located = await locateSkillFiles(dir);
    const out = [];
    for (const loc of located) {
        let raw = '';
        try {
            raw = await readFile(loc.skillFile, 'utf8');
        }
        catch {
            // Unreadable file — skip rather than collapse the whole catalog.
            continue;
        }
        const { frontmatter, description, body } = parseFrontmatter(raw);
        const fmName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
        if (isFlatMd(loc.skillFile) && !fmName && !description)
            continue;
        out.push({
            skillFile: loc.skillFile,
            resourceBase: loc.resourceBase,
            name: fmName,
            description,
            body,
            modelInvocable: !flag(frontmatter, 'disable-model-invocation', false),
            userInvocable: flag(frontmatter, 'user-invocable', true),
        });
    }
    return out;
}
export async function resolveAll() {
    const manifest = await readManifest();
    const out = [];
    for (const entry of manifest.skills) {
        if (!entry.enabled)
            continue;
        const dir = entry.subdir
            ? join(skillDir(entry.path), entry.subdir)
            : skillDir(entry.path);
        for (const s of await parseDirSkills(dir)) {
            const name = s.name || entry.name;
            out.push({
                entry,
                ...s,
                name,
                description: s.description || name,
            });
        }
    }
    return out;
}
export async function resolveByName(name) {
    const all = await resolveAll();
    return all.find((s) => s.name === name) ?? null;
}
/**
 * Preview which skills a directory would yield under the full skill rules —
 * used by `add` before registering, so empty results (docs-only repos, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export async function previewSkills(dir) {
    return parseDirSkills(dir);
}
//# sourceMappingURL=resolve.js.map
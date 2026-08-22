import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
async function isFile(p) {
    try {
        return (await stat(p)).isFile();
    }
    catch {
        return false;
    }
}
async function isDir(p) {
    try {
        return (await stat(p)).isDirectory();
    }
    catch {
        return false;
    }
}
export async function locateSkillFiles(dir) {
    // 1. Root SKILL.md is authoritative for the whole repo.
    const rootSkill = join(dir, 'SKILL.md');
    if (await isFile(rootSkill)) {
        return [{ skillFile: rootSkill, resourceBase: dir }];
    }
    const results = [];
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    // 2. Single-level subdirectory bundles: <dir>/<name>/SKILL.md
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        const sub = join(dir, entry.name);
        const candidate = join(sub, 'SKILL.md');
        if (await isFile(candidate)) {
            results.push({ skillFile: candidate, resourceBase: sub });
        }
    }
    // 3. Flat markdown files at the root: <dir>/<name>.md
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md'))
            continue;
        const lower = entry.name.toLowerCase();
        if (lower === 'readme.md' || lower === 'changelog.md' || lower === 'license.md')
            continue;
        results.push({ skillFile: join(dir, entry.name), resourceBase: dir });
    }
    return results;
}
//# sourceMappingURL=locator.js.map
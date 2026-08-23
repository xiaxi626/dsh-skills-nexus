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
    //
    // Doc-like files are skipped by *prefix pattern* (not exact name), so
    // variants such as README.zh-CN.md or CONTRIBUTING.md do not sneak in as
    // skills. Collection repos (e.g. trae-skills) keep such docs at the root.
    const SKIPPED_DOC_PREFIXES = [
        'readme',
        'changelog',
        'license',
        'contributing',
        'code-of-conduct',
        'code_of_conduct',
        'security',
    ];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md'))
            continue;
        const stem = entry.name.toLowerCase().replace(/\.md$/, '');
        if (SKIPPED_DOC_PREFIXES.some((p) => stem === p || stem.startsWith(`${p}.`)))
            continue;
        results.push({ skillFile: join(dir, entry.name), resourceBase: dir });
    }
    return results;
}
//# sourceMappingURL=locator.js.map
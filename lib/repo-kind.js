import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { locateSkillFiles } from './locator.js';
async function isFile(p) {
    try {
        return (await stat(p)).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Detect known DSH plugin markers at the repo root.
 *
 * The official way to make a package an installable DSH profile layer is to
 * ship a `cordis.patch.yml` and/or declare `dsh.bundle.patch` in package.json.
 * Keeping the detection conservative avoids treating arbitrary package.json
 * files as plugin markers.
 */
export async function detectDshPluginMarkers(dir) {
    const markers = [];
    for (const name of ['cordis.patch.yml', 'cordis.patch.yaml']) {
        if (await isFile(join(dir, name))) {
            markers.push(name);
        }
    }
    const pkgPath = join(dir, 'package.json');
    if (await isFile(pkgPath)) {
        try {
            const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
            if (pkg.dsh?.bundle?.patch) {
                markers.push('package.json#dsh.bundle.patch');
            }
        }
        catch {
            // Malformed package.json is not a DSH plugin marker by itself.
        }
    }
    return markers;
}
/** Classify a cloned repo based on SKILL.md presence and DSH plugin markers. */
export async function classifyRepo(dir, options = {}) {
    const [located, markers] = await Promise.all([
        locateSkillFiles(dir),
        detectDshPluginMarkers(options.markerDir ?? dir),
    ]);
    const hasSkill = located.length > 0;
    if (hasSkill && markers.length > 0) {
        return { kind: 'wrapped-skill', markers };
    }
    if (!hasSkill && markers.length > 0) {
        return { kind: 'dsh-plugin', markers };
    }
    if (hasSkill) {
        return { kind: 'plain-skill', markers };
    }
    return { kind: 'unknown', markers };
}
//# sourceMappingURL=repo-kind.js.map
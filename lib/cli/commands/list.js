import { readManifest } from '../../manifest.js';
import { REPOS_DIR, OFFICIAL_SKILLS_DIR, repoDir } from '../../paths.js';
import { stat } from 'node:fs/promises';
import { isEntryEnabled } from '../../link.js';
/** `list` — show registered skills and their status. */
export async function list(_argv) {
    const manifest = await readManifest();
    if (manifest.skills.length === 0) {
        process.stdout.write('No skills registered. Add one with: dsh-skills-nexus add github:owner/repo\n');
        return 0;
    }
    const rows = [];
    for (const s of manifest.skills) {
        const dir = repoDir(s.path);
        let present = 'missing';
        try {
            await stat(dir);
            present = 'ok';
        }
        catch {
            present = 'missing';
        }
        const linked = await isEntryEnabled(s);
        const state = linked ? 'on ' : 'off';
        rows.push([
            state,
            s.name,
            s.subdir ?? '—',
            s.ref,
            s.commit ? short(s.commit) : '—',
            present,
            s.updatedAt ? relative(s.updatedAt) : '—',
        ]);
    }
    const nameW = Math.max(4, ...rows.map((r) => r[1].length));
    const subW = Math.max(6, ...rows.map((r) => r[2].length));
    process.stdout.write(`    ${'NAME'.padEnd(nameW)}  ${'SUBDIR'.padEnd(subW)}  REF           COMMIT    DIR      UPDATED\n`);
    for (const r of rows) {
        process.stdout.write(`${r[0]}  ${r[1].padEnd(nameW)}  ${r[2].padEnd(subW)}  ${r[3].padEnd(13)}${r[4].padEnd(9)}${r[5].padEnd(9)}${r[6]}\n`);
    }
    process.stdout.write(`\n${rows.length} skill(s) · repos: ${REPOS_DIR}\n` +
        `  Symlinks in: ${OFFICIAL_SKILLS_DIR} (on = linked to catalog)\n`);
    return 0;
}
function short(sha) {
    return sha.slice(0, 7);
}
function relative(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then))
        return iso;
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0)
        return 'today';
    if (days === 1)
        return '1d ago';
    if (days < 30)
        return `${days}d ago`;
    return new Date(iso).toISOString().slice(0, 10);
}
//# sourceMappingURL=list.js.map
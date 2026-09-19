/**
 * Filesystem integrity checks for nexus-managed skills.
 *
 * Surfaced by the `doctor` CLI command — NOT from the plugin `apply()`, which
 * is an intentional no-op (a startup-time warning has no verified visible
 * output channel in DSH). Verifies that each manifest entry's symlinks in the
 * official skills root still point at valid target directories, and scans for
 * orphaned clones / links left behind when the manifest and the filesystem
 * drift apart. Purely filesystem-based — no git, no network.
 *
 * Design constraints:
 *   - Must never throw (it runs inside a read-only diagnostic command).
 *   - Disabled entries (no symlink) are normal and NOT reported.
 *   - Only missing targets produce issues.
 */
import { readdir, readlink, lstat, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { OFFICIAL_SKILLS_DIR, REPOS_DIR, repoDir } from './paths.js';
import { readManifest } from './manifest.js';
/* ------------------------------------------------------------------ */
/* Core diagnosis                                                      */
/* ------------------------------------------------------------------ */
/**
 * Diagnose a single manifest entry's symlink health.
 *
 * Scans `OFFICIAL_SKILLS_DIR` for symlinks whose resolved target falls inside
 * `repoDir(entry.path)`. Then verifies the target directory actually exists.
 *
 * Returns:
 *   - 'ok'             — at least one symlink points to a valid, existing directory
 *   - 'disabled'       — no symlink in the skills root points to this entry (normal)
 *   - 'missing-target' — a symlink was found and resolved, but the target directory does not exist
 *
 * A symlink whose readlink fails cannot be attributed to any entry (its target
 * is unreadable), so it is skipped here; the FS-side `findOrphanLinks()` scan
 * reports it instead as an `unreadable-link`.
 */
export async function diagnoseEntry(entry) {
    const base = resolve(repoDir(entry.path)) + sep;
    let names;
    try {
        names = await readdir(OFFICIAL_SKILLS_DIR);
    }
    catch {
        // Skills root doesn't exist — everything is effectively disabled.
        return 'disabled';
    }
    let foundLink = false;
    for (const name of names) {
        const linkPath = resolve(OFFICIAL_SKILLS_DIR, name);
        // Check if it's a symlink
        let st;
        try {
            st = await lstat(linkPath);
        }
        catch {
            continue;
        }
        if (!st.isSymbolicLink())
            continue;
        // Read the symlink target
        let target;
        try {
            target = await readlink(linkPath);
        }
        catch {
            // lstat says symlink but readlink fails — broken at OS level. We can't
            // read the target, so we can't confirm it belongs to this entry; skip.
            // findOrphanLinks() reports it as an unreadable-link instead.
            continue;
        }
        const resolved = resolve(OFFICIAL_SKILLS_DIR, target);
        // Does this symlink point inside the entry's repo directory?
        if (resolved !== base.slice(0, -1) && !resolved.startsWith(base))
            continue;
        foundLink = true;
        // Verify the target directory actually exists
        try {
            const targetStat = await stat(resolved);
            if (targetStat.isDirectory()) {
                // At least one healthy link exists — entry is ok.
                return 'ok';
            }
        }
        catch {
            // Target path doesn't exist on disk.
            // Continue scanning — there might be another link that IS valid.
            continue;
        }
    }
    if (!foundLink)
        return 'disabled';
    // We found link(s) pointing to this entry but none had a valid target.
    // Distinguish: if we got here, at least one symlink resolved to a path
    // inside the entry's repo but stat() failed on it.
    return 'missing-target';
}
/* ------------------------------------------------------------------ */
/* Batch health check                                                  */
/* ------------------------------------------------------------------ */
/**
 * Run health check on all manifest entries.
 * Returns only entries with real problems (missing-target).
 * Disabled entries are normal and excluded from results.
 */
export async function checkHealth() {
    const manifest = await readManifest();
    if (manifest.skills.length === 0)
        return [];
    const issues = [];
    for (const entry of manifest.skills) {
        const diagnosis = await diagnoseEntry(entry);
        if (diagnosis === 'missing-target') {
            issues.push({ name: entry.name, issue: diagnosis });
        }
    }
    return issues;
}
/* ------------------------------------------------------------------ */
/* Output formatting                                                   */
/* ------------------------------------------------------------------ */
/** Format health issues into a human-readable warning string. */
export function formatWarning(issues) {
    if (issues.length === 0)
        return '';
    const count = issues.length;
    const noun = count === 1 ? 'skill has a broken symlink' : 'skills have broken symlinks';
    const lines = [`[nexus] Warning: ${count} ${noun}:`];
    for (const { name } of issues) {
        lines.push(`  - ${name} (symlink points to missing directory)`);
    }
    const first = issues[0];
    if (count === 1 && first) {
        lines.push(`  Run \`dsh-skills-nexus update ${first.name}\` to re-clone and repair.`);
    }
    else {
        lines.push('  Run `dsh-skills-nexus update <name>` to repair individually.');
    }
    return lines.join('\n');
}
/* ------------------------------------------------------------------ */
/* Orphan detection (FS-side scans; complement the manifest-side checks)*/
/* ------------------------------------------------------------------ */
/**
 * Repo clone directories under `REPOS_DIR` that no manifest entry references —
 * leftover clones from an entry that was removed (or a manifest that was reset).
 * Returns repo-relative directory names (the top-level segment under `repos/`).
 */
export async function findOrphanRepos(entries) {
    let names;
    try {
        names = await readdir(REPOS_DIR);
    }
    catch {
        return []; // repos/ not created yet — nothing can be orphaned
    }
    // A top-level dir is referenced if some entry.path equals it or nests under it.
    const referenced = (dir) => entries.some((e) => e.path === dir || e.path.startsWith(dir + sep) || e.path.startsWith(dir + '/'));
    const orphans = [];
    for (const name of names) {
        const abs = resolve(REPOS_DIR, name);
        let st;
        try {
            st = await stat(abs);
        }
        catch {
            continue;
        }
        if (!st.isDirectory())
            continue;
        if (!referenced(name))
            orphans.push(name);
    }
    return orphans;
}
/**
 * Symlinks in `OFFICIAL_SKILLS_DIR` that nexus can no longer account for.
 *
 * Only symlinks whose resolved target falls inside `REPOS_DIR` are considered —
 * anything pointing elsewhere is the user's own skill, not nexus's business.
 * Three cases:
 *   - `unreadable-link` — readlink failed; the target is unknown, so the link
 *     cannot be attributed to nexus. A caution only — never a delete hint.
 *   - `dangling-link`   — target resolves inside repos/ but no longer exists.
 *   - `orphan-link`     — target exists inside repos/ but no entry claims it.
 *
 * A link that a live entry *does* claim is skipped here — `diagnoseEntry`
 * already reports its health, so this avoids double-reporting the same problem.
 */
export async function findOrphanLinks(entries) {
    let names;
    try {
        names = await readdir(OFFICIAL_SKILLS_DIR);
    }
    catch {
        return []; // skills root absent — nothing to scan
    }
    const reposBase = resolve(REPOS_DIR) + sep;
    const bases = entries.map((e) => resolve(repoDir(e.path)) + sep);
    const claimedBy = (resolved) => bases.some((b) => resolved === b.slice(0, -1) || resolved.startsWith(b));
    const out = [];
    for (const name of names) {
        const linkPath = resolve(OFFICIAL_SKILLS_DIR, name);
        let st;
        try {
            st = await lstat(linkPath);
        }
        catch {
            continue;
        }
        if (!st.isSymbolicLink())
            continue; // a real dir/file the user placed — ignore
        let target;
        try {
            target = await readlink(linkPath);
        }
        catch {
            // Can't read the target → can't confirm nexus ownership. Caution only.
            out.push({ name, code: 'unreadable-link' });
            continue;
        }
        const resolved = resolve(OFFICIAL_SKILLS_DIR, target);
        // Only links pointing into repos/ are nexus's concern.
        if (resolved !== reposBase.slice(0, -1) && !resolved.startsWith(reposBase))
            continue;
        // A live entry claims it → diagnoseEntry handles its health; skip.
        if (claimedBy(resolved))
            continue;
        let exists = false;
        try {
            const tst = await stat(resolved);
            exists = tst.isDirectory();
        }
        catch {
            exists = false;
        }
        out.push({ name, code: exists ? 'orphan-link' : 'dangling-link', target: resolved });
    }
    return out;
}
//# sourceMappingURL=health.js.map
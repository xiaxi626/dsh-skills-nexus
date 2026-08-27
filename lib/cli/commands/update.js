import { join } from 'node:path';
import { readManifest, markUpdated } from '../../manifest.js';
import { repoDir } from '../../paths.js';
import { checkoutRef, discardLocalChanges, getHeadCommit, isDetachedHead, isDirtyWorktree, pullRepo, resolveRefCommit, sanitizeName, } from '../../git.js';
import { previewSkills } from '../../resolve.js';
import { normalizeSkillName, ensureDescription } from '../../frontmatter.js';
import { linkSkill, isEntryEnabled } from '../../link.js';
import { positional } from '../args.js';
/**
 * `update [name]` — bring a skill's clone to the latest state, or verify a
 * pinned one. Re-normalizes frontmatter and re-creates symlinks after pull.
 *
 * Dispatch is decided by how the clone was pinned at `add` time:
 *   - branch pin (symbolic HEAD) → `git pull --ff-only`
 *   - tag / commit pin (detached) → verify pin, restore if drifted
 *
 * After update, frontmatter is re-normalized (git pull may have overwritten
 * previous fixes) and symlinks are re-created.
 *
 * A dirty worktree would block `git pull --ff-only` and pin restoration —
 * and install-time normalization rewrites `SKILL.md` in place, so managed
 * clones are usually dirty. Local changes are therefore discarded (with a
 * warning) before pulling / restoring; normalization is re-applied after.
 */
export async function update(argv) {
    const manifest = await readManifest();
    const target = positional(argv);
    // Update all enabled (linked) skills by default, or a specific target.
    const targets = target
        ? manifest.skills.filter((s) => s.name === target)
        : (await Promise.all(manifest.skills.map(async (s) => ({ s, linked: await isEntryEnabled(s) })))).filter(({ linked }) => linked).map(({ s }) => s);
    if (target && targets.length === 0) {
        process.stderr.write(`No skill named "${target}".\n`);
        return 1;
    }
    if (targets.length === 0) {
        process.stdout.write('Nothing to update (no enabled skills).\n');
        return 0;
    }
    let failures = 0;
    for (const s of targets) {
        const dir = repoDir(s.path);
        process.stdout.write(`Updating ${s.name} (${s.ref})…\n`);
        try {
            const before = await getHeadCommit(dir);
            let after;
            // Clones are nexus-managed: discard local changes (warned) so the
            // pull / restore below cannot be blocked by a dirty worktree.
            if (await isDirtyWorktree(dir)) {
                process.stdout.write('  ⚠ discarding local changes in nexus-managed clone\n');
                await discardLocalChanges(dir);
            }
            if (await isDetachedHead(dir)) {
                // Tag / commit pin — verify and restore if drifted.
                const want = await resolveRefCommit(dir, s.ref);
                if (before !== want) {
                    await checkoutRef(dir, s.ref);
                    after = await getHeadCommit(dir);
                    process.stdout.write(`  ✓ restored to pinned ${short(after)}\n`);
                }
                else {
                    after = before;
                    process.stdout.write(`  ✓ pinned at ${short(after)} — nothing to update\n`);
                }
            }
            else {
                // Branch pin — fast-forward.
                await pullRepo(dir);
                after = await getHeadCommit(dir);
                process.stdout.write(after === before
                    ? `  ✓ up to date (${short(after)})\n`
                    : `  ✓ ${short(before)} → ${short(after)}\n`);
            }
            // --- Re-normalize frontmatter after pull ---
            const skillRoot = s.subdir ? join(dir, s.subdir) : dir;
            const skills = await previewSkills(skillRoot);
            for (const ps of skills) {
                const validName = ps.invalidName ? sanitizeName(ps.invalidName) : (ps.name || s.name);
                if (ps.invalidName) {
                    await normalizeSkillName(ps.skillFile, validName);
                    process.stdout.write(`  ⚠ re-normalized name: "${ps.invalidName}" → "${validName}"\n`);
                }
                if (!ps.description || ps.description.trim().length === 0) {
                    await ensureDescription(ps.skillFile, validName);
                    process.stdout.write(`  ⚠ added missing description for "${validName}"\n`);
                }
            }
            // --- Re-create symlinks (in case names changed or new skills appeared) ---
            const wasLinked = await isEntryEnabled(s);
            if (wasLinked) {
                for (const ps of skills) {
                    const fmName = ps.invalidName ? sanitizeName(ps.invalidName) : ps.name;
                    const linkName = skills.length === 1 ? s.name : (fmName || s.name);
                    await linkSkill(linkName, ps.resourceBase);
                }
            }
            await markUpdated(s.name, after);
        }
        catch (err) {
            failures++;
            process.stderr.write(`  ✗ failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
    }
    return failures === 0 ? 0 : 1;
}
function short(sha) {
    return sha.slice(0, 7);
}
//# sourceMappingURL=update.js.map
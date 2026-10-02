import { join } from 'node:path';
import { readManifest, markUpdated } from '../../manifest.js';
import { repoDir } from '../../paths.js';
import { checkoutRef, discardLocalChanges, getHeadCommit, isDetachedHead, isDirtyWorktree, pullRepo, resolveRefCommit, sanitizeName, } from '../../git.js';
import { previewSkills } from '../../resolve.js';
import { normalizeSkillName, ensureDescription } from '../../frontmatter.js';
import { entryLinks, isEntryEnabled, linkSkill, unlinkSkill } from '../../link.js';
import { cliIO } from '../../ops-io.js';
import { acquireSkillFileLock } from '../../locks.js';
import { positional } from '../args.js';
import { batchPrefix, withSpinner } from '../progress.js';
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
export async function update(argv, io = cliIO) {
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
        io.emit('Nothing to update (no enabled skills).\n');
        return 0;
    }
    let failures = 0;
    const total = targets.length;
    for (let i = 0; i < targets.length; i++) {
        const s = targets[i];
        const dir = repoDir(s.path);
        io.emit(`${batchPrefix(i + 1, total)}Updating ${s.name} (${s.ref})…\n`);
        // §7.3 layer 3: cross-process exclusion against CLI/server collisions.
        // Acquire failure flows into the same per-item failure path as any other
        // error (message explains the lock), with release guaranteed by finally.
        let lock;
        try {
            lock = await acquireSkillFileLock(s.name);
            const before = await getHeadCommit(dir);
            let after;
            // Clones are nexus-managed: discard local changes (warned) so the
            // pull / restore below cannot be blocked by a dirty worktree.
            if (await isDirtyWorktree(dir)) {
                io.emit('  ⚠ discarding local changes in nexus-managed clone\n');
                await discardLocalChanges(dir);
            }
            if (await isDetachedHead(dir)) {
                // Tag / commit pin — verify and restore if drifted.
                const want = await resolveRefCommit(dir, s.ref);
                if (before !== want) {
                    await checkoutRef(dir, s.ref);
                    after = await getHeadCommit(dir);
                    io.emit(`  ✓ restored to pinned ${short(after)}\n`);
                }
                else {
                    after = before;
                    io.emit(`  ✓ pinned at ${short(after)} — nothing to update\n`);
                }
            }
            else {
                // Branch pin — fast-forward. `git pull` is the only network step in
                // `update`, so it's the one worth animating.
                await withSpinner(`pulling ${s.name}`, () => pullRepo(dir));
                after = await getHeadCommit(dir);
                io.emit(after === before
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
                    io.emit(`  ⚠ re-normalized name: "${ps.invalidName}" → "${validName}"\n`);
                }
                if (!ps.description || ps.description.trim().length === 0) {
                    await ensureDescription(ps.skillFile, validName);
                    io.emit(`  ⚠ added missing description for "${validName}"\n`);
                }
            }
            // --- Rebuild links: drop the previously attributed set first (§8.1) ---
            //
            // Upstream may have renamed a skill or deleted one entirely: a link kept
            // under its old name would either surface the same SKILL.md under two
            // names or dangle once its skill directory is gone — and a later `remove`
            // (which derives names from the current clone) could not clean it up
            // either. Same record → unlink → relink rule as switch-version (§8.2
            // step 6); like there, an entry with no attributed links is disabled and
            // must not be silently re-enabled.
            const oldLinks = await entryLinks(s);
            for (const l of oldLinks)
                await unlinkSkill(l.name);
            if (oldLinks.length > 0) {
                const rebuilt = new Set();
                for (const ps of skills) {
                    const fmName = ps.invalidName ? sanitizeName(ps.invalidName) : ps.name;
                    const linkName = skills.length === 1 ? s.name : (fmName || s.name);
                    await linkSkill(linkName, ps.resourceBase);
                    rebuilt.add(linkName);
                }
                const dropped = oldLinks.map((l) => l.name).filter((n) => !rebuilt.has(n));
                if (dropped.length > 0) {
                    io.emit(`  ⚠ dropped ${dropped.length} stale link(s) no longer provided upstream: ${dropped.join(', ')}\n`);
                }
            }
            await markUpdated(s.name, after);
        }
        catch (err) {
            failures++;
            process.stderr.write(`  ✗ failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        finally {
            await lock?.release();
        }
    }
    return failures === 0 ? 0 : 1;
}
function short(sha) {
    return sha.slice(0, 7);
}
//# sourceMappingURL=update.js.map
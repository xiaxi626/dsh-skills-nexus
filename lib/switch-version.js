import { join } from 'node:path';
import { findEntry, markUpdated, readManifest } from './manifest.js';
import { repoDir } from './paths.js';
import { checkoutBranch, checkoutRef, discardLocalChanges, fetchRepo, getCurrentBranch, getHeadCommit, isDirtyWorktree, resolveSwitchTarget, sanitizeName, } from './git.js';
import { entryLinks, linkSkill, unlinkSkill } from './link.js';
import { previewSkills } from './resolve.js';
import { normalizeSkillName, ensureDescription } from './frontmatter.js';
/**
 * `switch-version` — move an entry's clone to another branch / tag / commit
 * and rebuild everything derived from the checkout (§8.2, seven steps +
 * rollback):
 *
 *   1. record the old link set and the old checkout (what a rollback restores)
 *   2. fetch — a `--depth 1` clone holds no other refs/tags locally
 *   3. resolve + verify the target; a missing ref leaves the clone untouched
 *   4. discard drift, then check out the target
 *   5. re-normalize frontmatter (the checkout restored raw upstream files)
 *   6. drop the old links, create the new set (names may have changed)
 *   7. record the new commit + ref (`refType` is a transient hint, never stored)
 *
 * Design deviation (§6.3 lists `src/git.ts` for `switchVersion`): the
 * orchestration lives in this module so `git.ts` stays a pure git-primitive
 * layer — the steps above also touch the manifest, symlinks and frontmatter,
 * which `git.ts` must not depend on.
 */
/** The manifest has no entry under this name. */
export class SkillNotFoundError extends Error {
    skillName;
    constructor(skillName) {
        super(`No skill named "${skillName}".`);
        this.name = 'SkillNotFoundError';
        this.skillName = skillName;
    }
}
/**
 * The requested ref could not be resolved — neither freshly fetched nor
 * already present locally. Thrown before any state change (§8.2 step 3).
 */
export class RefNotFoundError extends Error {
    ref;
    constructor(ref) {
        super(`Ref "${ref}" was not found — nothing was changed.`);
        this.name = 'RefNotFoundError';
        this.ref = ref;
    }
}
/** Zip-source entries have no git history to switch (§9.3 → 400 zip-not-updatable). */
export class ZipNotUpdatableError extends Error {
    skillName;
    constructor(skillName) {
        super(`Skill "${skillName}" was installed from a zip archive — ` +
            `version switching requires a git clone.`);
        this.name = 'ZipNotUpdatableError';
        this.skillName = skillName;
    }
}
/**
 * Switch the entry's clone to `ref` and rebuild the derived state.
 *
 * `refType` is the caller's hint (branch vs tag/commit, §8.2): the checkout
 * style actually follows what the fetch landed; the hint only orders the
 * offline fallback when nothing could be fetched. It is never persisted.
 */
export async function switchVersion(name, ref, refType, io) {
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (!entry)
        throw new SkillNotFoundError(name);
    if (entry.source === 'zip')
        throw new ZipNotUpdatableError(name);
    const dest = repoDir(entry.path);
    const skillRoot = entry.subdir ? join(dest, entry.subdir) : dest;
    // 1 — record the old link set and the old checkout before any mutation:
    //     together they are what a failed switch rolls back to.
    const oldLinks = await entryLinks(entry);
    const before = await getHeadCommit(dest);
    const wasBranch = await getCurrentBranch(dest);
    // 2 — fetch. Mandatory for shallow clones: `--depth 1` holds no other
    //     refs/tags locally, so `git checkout <tag>` without this fails.
    io.progress('fetching', ref);
    const landed = await fetchRepo(dest, ref);
    // 3 — resolve + verify. Nothing has been mutated yet (only remote refs
    //     were updated), so a missing ref leaves the clone untouched.
    const target = await resolveSwitchTarget(dest, ref, landed, refType);
    if (!target)
        throw new RefNotFoundError(ref);
    const wasDirty = await isDirtyWorktree(dest);
    let after;
    const links = [];
    try {
        // 4 — discard drift (install-time normalization rewrites SKILL.md, so a
        //     managed clone is typically dirty), then check out the target.
        if (wasDirty) {
            io.emit('  ⚠ discarding local changes in nexus-managed clone\n');
            await discardLocalChanges(dest);
        }
        if (target.kind === 'branch') {
            await checkoutBranch(dest, ref);
        }
        else {
            await checkoutRef(dest, target.commit);
        }
        after = await getHeadCommit(dest);
        // 5 — re-normalize frontmatter: the checkout restored raw upstream files
        //     (same install-time convention as `add` / `update`).
        const skills = await previewSkills(skillRoot);
        for (const ps of skills) {
            const validName = ps.invalidName ? sanitizeName(ps.invalidName) : (ps.name || entry.name);
            if (ps.invalidName) {
                await normalizeSkillName(ps.skillFile, validName);
            }
            if (!ps.description || ps.description.trim().length === 0) {
                await ensureDescription(ps.skillFile, validName);
            }
        }
        // 6 — rebuild links. Drop the old set first: names may repeat across the
        //     switch, and a new link created before the old one were removed
        //     would be deleted by the cleanup. Only rebuild when the entry was
        //     linked — a disabled entry must not be silently re-enabled.
        const wasLinked = oldLinks.length > 0;
        for (const l of oldLinks)
            await unlinkSkill(l.name);
        if (wasLinked) {
            for (const ps of skills) {
                const fmName = ps.invalidName ? sanitizeName(ps.invalidName) : ps.name;
                const linkName = skills.length === 1 ? entry.name : (fmName || entry.name);
                await linkSkill(linkName, ps.resourceBase);
                links.push(linkName);
            }
        }
        // 7 — record the new version; `refType` is a transient hint, never stored.
        await markUpdated(entry.name, after, ref);
    }
    catch (err) {
        await rollbackSwitch(dest, entry, oldLinks, before, wasBranch);
        throw err;
    }
    return { name: entry.name, ref, before, after, kind: target.kind, wasDirty, links };
}
/**
 * Best-effort rollback of steps 4–6 (§8.2): restore the previous checkout,
 * then the previous link set. The original error is what the caller must
 * see, so a rollback failure is swallowed.
 *
 * `git checkout <wasBranch>` — not `checkout -B` — re-attaches HEAD without
 * touching the branch ref: the failed switch only ever reset the *target*
 * branch, so the old branch still points at `before`. When the clone was
 * detached, the rollback pins the exact old commit.
 */
async function rollbackSwitch(dest, entry, oldLinks, before, wasBranch) {
    try {
        await checkoutRef(dest, wasBranch ?? before);
        for (const l of await entryLinks(entry))
            await unlinkSkill(l.name);
        for (const l of oldLinks)
            await linkSkill(l.name, l.target);
    }
    catch {
        // Best-effort — the switch error reaches the caller regardless.
    }
}
//# sourceMappingURL=switch-version.js.map
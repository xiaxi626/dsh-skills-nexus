import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { findEntry, hasGitSource, isExternalEntry, readManifest, writeManifest, } from './manifest.js';
import { REPOS_DIR, repoDir } from './paths.js';
import { cloneRepo, getDefaultBranch, getHeadCommit, isRealDirectory, normalizeSubdir, parseGitSpec, sanitizeName, } from './git.js';
import { entryLinks, hasCollision, linkSkill, unlinkSkill } from './link.js';
import { previewSkills } from './resolve.js';
import { ensureDescription, normalizeSkillName } from './frontmatter.js';
/** An adopt was refused, failed, or failed and was rolled back. */
export class AdoptError extends Error {
    /** Stable machine-readable code. */
    code;
    constructor(code, message) {
        super(message);
        this.name = 'AdoptError';
        this.code = code;
    }
}
/**
 * Re-source `name` from `url` and rebuild everything derived from it.
 *
 * The entry must currently have no git source; `--force` both lifts that
 * precondition and bypasses the discovery-mismatch guard (step 2), which is
 * what makes "adopt the other repository instead" a deliberate act rather than
 * a silent catalog change.
 */
export async function adoptSkill(options) {
    const { name, io, force, prune } = options;
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (!entry)
        throw new AdoptError('skill-not-found', `No skill named "${name}".`);
    if (isExternalEntry(entry)) {
        throw new AdoptError('external-entry', `"${name}" only links a directory you own (ownership: external) — ` +
            `adopting it would have to replace that directory, which nexus must not touch.\n` +
            `Remove the entry and install the source with "dsh-skills-nexus add" instead.`);
    }
    if (hasGitSource(entry) && force !== true) {
        throw new AdoptError('already-has-source', `"${name}" already has a git source (${entry.gitUrl}); ` +
            `pass --force to replace it with another one.`);
    }
    // 1 — resolve the new source and clone it into a staging directory under
    //     repos/. Nothing the manifest names has been touched at this point.
    const subdir = resolveSubdir(options.subdir ?? entry.subdir);
    const spec = typeof options.url === 'string' ? options.url.trim() : '';
    if (spec.length === 0) {
        throw new AdoptError('invalid-url', '--url requires a repository URL, e.g. --url https://github.com/owner/repo');
    }
    let gitSpec;
    try {
        gitSpec = parseGitSpec(spec, options.ref ?? 'main');
    }
    catch (err) {
        throw new AdoptError('invalid-url', message(err));
    }
    if (options.ref === undefined && !spec.includes('#')) {
        io.progress('resolving default branch', gitSpec.url);
        gitSpec = { ...gitSpec, ref: await getDefaultBranch(gitSpec.url) };
    }
    const dest = repoDir(entry.path);
    const skillRoot = subdir === undefined ? dest : join(dest, subdir);
    // A hidden, per-process staging name: `cloneRepo` refuses to clone into an
    // existing path, so it must not collide with a concurrent adopt — which the
    // per-entry file lock (CLI) already prevents for the same entry.
    const stage = join(REPOS_DIR, `.adopt-stage-${sanitizeName(name)}-${process.pid}-${Date.now()}`);
    const stageRoot = subdir === undefined ? stage : join(stage, subdir);
    // The old link set is what a rollback restores, so it is read before the
    // first mutation. `entryLinks` judges ownership by target, so it works even
    // when the directory is already gone.
    const oldLinks = await entryLinks(entry);
    const wasLinked = oldLinks.length > 0;
    let backup;
    let backedUp = false;
    let moved = false;
    try {
        await mkdir(REPOS_DIR, { recursive: true });
        io.progress('cloning', `${gitSpec.url} (${gitSpec.ref})`);
        try {
            await cloneRepo(gitSpec, stage, subdir === undefined ? {} : { subdir });
        }
        catch (err) {
            throw new AdoptError('clone-failed', `could not clone ${gitSpec.url} (${gitSpec.ref}): ${message(err)}`);
        }
        // 2 — the installer's own discovery rules, unchanged: what the new source
        //     yields must match what the entry exposes today. A directory that
        //     yields nothing (missing, or emptied by hand) has nothing to compare
        //     against and does not block the repair.
        if (subdir !== undefined && !(await isRealDirectory(stageRoot))) {
            throw new AdoptError('not-a-directory', `"${subdir}" is not a real directory in ${gitSpec.url} (${gitSpec.ref}) — ` +
                `a committed symlink cannot be a skill root. Nothing was changed.`);
        }
        const staged = await previewSkills(stageRoot);
        if (staged.length === 0) {
            throw new AdoptError('no-skill-found', `${gitSpec.url} (${gitSpec.ref}) yields no installable skill` +
                `${subdir === undefined ? '' : ` at "${subdir}"`}. Nothing was changed.`);
        }
        const next = derivedLinkNames(entry.name, staged);
        const current = derivedLinkNames(entry.name, await previewSkills(skillRoot));
        if (current.length > 0 && !sameLinkSet(current, next) && force !== true) {
            throw new AdoptError('skill-mismatch', `"${name}" exposes ${list(current)} today, but ${gitSpec.url} (${gitSpec.ref}) ` +
                `yields ${list(next)}.\n` +
                `Nothing was changed; pass --force to adopt this source anyway.`);
        }
        if (wasLinked) {
            for (const linkName of next) {
                if (await hasCollision(linkName)) {
                    throw new AdoptError('collision', `a file or directory named "${linkName}" already exists in the official ` +
                        `skills root; remove it first. Nothing was changed.`);
                }
            }
        }
        // The install-time normalization convention (see the module comment). It
        // runs on the staged tree, so a failure cannot leave a half-normalized
        // directory behind in the live entry.
        let normalized = 0;
        for (const ps of staged) {
            const validName = ps.invalidName ? sanitizeName(ps.invalidName) : (ps.name || entry.name);
            if (ps.invalidName) {
                await normalizeSkillName(ps.skillFile, validName);
                normalized++;
            }
            if (!ps.description || ps.description.trim().length === 0) {
                await ensureDescription(ps.skillFile, validName);
                normalized++;
            }
        }
        // 3 — back the current directory up. `repos/<path>` is nexus's own
        //     directory (§2.1 form (a)/(b) only — external entries were refused
        //     above), so replacing it is this operation's business.
        if (await exists(dest)) {
            const kept = `${dest}.pre-adopt-${Date.now()}`;
            await rename(dest, kept);
            backup = kept;
            backedUp = true;
        }
        // 4 — the staged clone takes its place.
        await rename(stage, dest);
        moved = true;
        // 5 — rebuild the links, the way switch-version step 6 does: drop the old
        //     set first (names may repeat, and a new link created before an old one
        //     was removed would be deleted by the cleanup), then create the new
        //     set — but only when the entry was linked. A disabled entry must not
        //     be silently enabled by adopting it.
        const landed = await previewSkills(skillRoot);
        const links = [];
        for (const l of oldLinks)
            await unlinkSkill(l.name);
        if (wasLinked) {
            const names = derivedLinkNames(entry.name, landed);
            for (let i = 0; i < landed.length; i++) {
                await linkSkill(names[i], landed[i].resourceBase);
                links.push(names[i]);
            }
        }
        // 6 — the entry has an identity now. From here the adopt is committed:
        //     everything below must not roll anything back.
        const commit = await headCommitOrEmpty(dest);
        await applyAdopt(entry.name, {
            url: spec,
            gitUrl: gitSpec.url,
            ref: gitSpec.ref,
            commit,
            ...(subdir === undefined ? {} : { subdir }),
        });
        // 7 — prune the backup, or report where it is.
        let pruned = false;
        if (backup !== undefined && prune === true) {
            try {
                await rm(backup, { recursive: true, force: true });
                pruned = true;
            }
            catch (err) {
                // Deleting a backup is housekeeping: failing at it must not undo a
                // committed adopt, so the path is reported instead.
                io.emit(`  ⚠ could not remove the backup at ${backup}: ${message(err)}\n`);
            }
        }
        return {
            name: entry.name,
            path: entry.path,
            url: spec,
            gitUrl: gitSpec.url,
            ref: gitSpec.ref,
            commit,
            ...(subdir === undefined ? {} : { subdir }),
            skills: derivedLinkNames(entry.name, landed),
            links,
            wasEnabled: wasLinked,
            normalized,
            ...(pruned || backup === undefined ? {} : { backup }),
            pruned,
        };
    }
    catch (err) {
        await rollbackAdopt(entry, dest, oldLinks, backup, backedUp, moved);
        // The stage is either still there (anything before step 4) or already
        // renamed into place and removed again by the rollback — `force` makes the
        // second case a no-op.
        await rm(stage, { recursive: true, force: true });
        if (err instanceof AdoptError)
            throw err;
        throw new AdoptError('adopt-failed', `${message(err)} — ` +
            (moved || backedUp
                ? `nothing was changed: the previous directory and links were restored`
                : `nothing was changed`));
    }
}
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function message(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * The `--subdir` value to use: the caller's, else the entry's recorded one.
 *
 * `subdir` is part of the entry's identity — §7 notes that the new command
 * semantics express a clone offset *only* through it — so re-sourcing an entry
 * keeps its root unless the caller names a different one. `.` means the clone
 * root, which the manifest records as "no subdir" (its absence *is* the root).
 */
function resolveSubdir(raw) {
    if (raw === undefined)
        return undefined;
    let normalized;
    try {
        normalized = normalizeSubdir(raw);
    }
    catch (err) {
        throw new AdoptError('invalid-subdir', message(err));
    }
    return normalized === '.' ? undefined : normalized;
}
/**
 * The link name each discovered skill would be exposed under — the same rule
 * every install path uses (`add`, `import`, `switch-version` step 6): a
 * single-skill root is named after the entry, a multi-skill root after each
 * skill's frontmatter name, with the entry name as the fallback.
 *
 * One function answers "what would this tree link as" for the old and the new
 * tree alike, so the guard in step 2 compares like with like — including the
 * sanitized spelling of a frontmatter name the provider would reject, which is
 * stable whether or not the normalization has run yet.
 */
function derivedLinkNames(entryName, skills) {
    return skills.map((ps) => {
        const fmName = ps.invalidName ? sanitizeName(ps.invalidName) : ps.name;
        return skills.length === 1 ? entryName : (fmName || entryName);
    });
}
/** True when two link-name sets describe the same catalog (order-insensitive). */
function sameLinkSet(a, b) {
    return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}
/** A name list for an error message. */
function list(names) {
    return names.length === 0 ? 'no skills' : names.join(', ');
}
async function exists(path) {
    try {
        await lstat(path);
        return true;
    }
    catch {
        return false;
    }
}
/** The fresh clone's commit; an unreadable HEAD records no commit rather than lying. */
async function headCommitOrEmpty(dest) {
    try {
        return await getHeadCommit(dest);
    }
    catch {
        return '';
    }
}
/**
 * Write the adopted identity into the manifest (§6 step 6). The entry keeps its
 * name, its `path` and its `addedAt`; `subdir` is replaced (or dropped, when
 * the source sits at its root) and `updatedAt` is re-stamped like any other
 * successful version change.
 */
async function applyAdopt(name, next) {
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (!entry)
        return;
    entry.url = next.url;
    entry.gitUrl = next.gitUrl;
    entry.ref = next.ref;
    entry.commit = next.commit;
    entry.updatedAt = new Date().toISOString();
    if (next.subdir === undefined)
        delete entry.subdir;
    else
        entry.subdir = next.subdir;
    await writeManifest(manifest);
}
/**
 * Best-effort rollback of steps 3–5 (§6): put the previous directory back,
 * then the previous link set. The original error is what the caller must see,
 * so a rollback failure is swallowed — the same contract as `rollbackSwitch`.
 *
 * The guard is deliberately `backedUp || moved` and not `moved`: between the
 * backup rename and the stage rename the old directory exists only under the
 * backup name, so an error there still has to be undone.
 */
async function rollbackAdopt(entry, dest, oldLinks, backup, backedUp, moved) {
    if (!backedUp && !moved)
        return;
    try {
        // Whatever points into the entry's directory right now is the new set (or
        // a partial rebuild); the old one was recorded before anything changed.
        for (const l of await entryLinks(entry))
            await unlinkSkill(l.name);
        await rm(dest, { recursive: true, force: true });
        if (backup !== undefined)
            await rename(backup, dest);
        for (const l of oldLinks)
            await linkSkill(l.name, l.target);
    }
    catch {
        // Best-effort — the adopt error reaches the caller regardless.
    }
}
//# sourceMappingURL=adopt.js.map
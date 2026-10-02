import { hasEntry, readManifest } from '../../manifest.js';
import { getDefaultBranch, normalizeSubdir, parseGitSpec, repoSlug, sanitizeName, } from '../../git.js';
import { hasCollision } from '../../link.js';
import { installFromGit } from '../../install.js';
import { cliIO } from '../../ops-io.js';
import { withSkillFileLock, SkillLockedError } from '../../locks.js';
import { parseAddArgs } from '../args.js';
import { batchPrefix, withSpinner } from '../progress.js';
/**
 * `add` — clone one or more GitHub SKILL.md repos and expose each via symlinks
 * in the official DSH skills root.
 *
 * Each clone lands under <repos>/<path>/ and a symlink is created at
 * ~/.dsh/skills/<name>/ so the official filesystem provider discovers it
 * automatically. Multi-skill repos create one symlink per discovered skill.
 *
 * `--subdir <path>` installs a single subdirectory of the clone (collection
 * repos): the subdir is the skill root, the entry gets a `subdir` field, and
 * the clone directory is dedicated to that entry (independent-clone design).
 * Such a clone is sparse when Git and the remote allow it (partial clone +
 * cone-mode sparse-checkout), so unrelated directories are normally not
 * materialized; the command reports which mode was used.
 *
 * Multiple specs are installed left-to-right and independently: a failure on
 * one repo does not abort the rest, and the exit code is non-zero if any repo
 * failed (the same per-item model as `update`). The per-repo options
 * (--name/--ref/--subdir) are one-to-one with a single repo, so combining them
 * with multiple specs is rejected up front rather than silently misapplied.
 *
 * Before registering, each clone is *previewed* with the full skill rules, so
 * repos that yield zero installable skills are rejected.
 */
export async function add(argv, io = cliIO) {
    const { specs, name, ref, subdir, yes } = parseAddArgs(argv);
    // --name/--ref/--subdir each refine a single repo; they cannot be spread
    // across several specs unambiguously. Refuse explicitly instead of silently
    // applying them to just one (the old "last positional wins" footgun).
    if (specs.length > 1 && (name || ref || subdir)) {
        const used = [name && '--name', ref && '--ref', subdir && '--subdir']
            .filter(Boolean)
            .join(', ');
        process.stderr.write(`${used} applies to a single repo and cannot be combined with ${specs.length} repo specs.\n` +
            `Run a separate "dsh-skills-nexus add <repo> ${used}" command per repo to customize each,\n` +
            `or drop the option to install all ${specs.length} repos with their default names.\n`);
        return 1;
    }
    const multi = specs.length > 1;
    let failures = 0;
    let addedCount = 0;
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        // Batch counter: only meaningful for multi-repo runs; printed to stdout so
        // non-interactive logs also show which spec is in flight.
        if (multi)
            io.emit(`\n${batchPrefix(i + 1, specs.length)}${spec}\n`);
        try {
            const res = await addOne(spec, { name, ref, subdir, yes }, io);
            if (res.status === 'failed')
                failures++;
            else if (res.status === 'added')
                addedCount++;
        }
        catch (err) {
            // A thrown error (e.g. clone / network failure) is a per-item failure —
            // isolate it so the remaining specs still get a chance to install.
            failures++;
            process.stderr.write(`✗ ${spec}: ${err instanceof Error ? err.message : String(err)}\n`);
        }
    }
    if (multi) {
        io.emit(`\n${addedCount}/${specs.length} repo(s) added` +
            (failures > 0 ? `, ${failures} failed` : '') +
            `.\n`);
    }
    return failures === 0 ? 0 : 1;
}
/**
 * Install one repo spec. All user-facing messaging is preserved verbatim from
 * the original single-repo `add`; the former `return 0`/`return 1` exit codes
 * map to `skipped`/`failed` so the caller can aggregate across multiple specs
 * without changing what a single-spec run prints or returns.
 *
 * The read-only preflight lives here (it must run before anything is created);
 * the filesystem-mutating phase itself is `installFromGit` in `src/install.ts`
 * — the one install implementation every git-source channel shares (§10.1).
 */
async function addOne(spec, opts, io) {
    const { name, ref, subdir, yes } = opts;
    // `--subdir` is validated before anything network-bound: it must be a
    // repository-relative directory, never an escape hatch out of the clone.
    let normalizedSubdir;
    if (subdir !== undefined) {
        try {
            normalizedSubdir = normalizeSubdir(subdir);
        }
        catch (err) {
            process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
            return { status: 'failed' };
        }
    }
    // Parse once to get the URL; we'll refine the ref below if needed.
    let gitSpec = parseGitSpec(spec, ref ?? 'main');
    // If user didn't pin a ref, detect the remote's default branch.
    if (!ref && !spec.includes('#')) {
        io.emit(`Detecting default branch for ${gitSpec.url}…\n`);
        const detected = await withSpinner('resolving default branch', () => getDefaultBranch(gitSpec.url));
        if (detected !== gitSpec.ref) {
            io.emit(`  → using ${detected} (detected)\n`);
        }
        gitSpec = { ...gitSpec, ref: detected };
    }
    const repoBase = sanitizeName(repoSlug(gitSpec));
    const subdirLeaf = normalizedSubdir
        ? sanitizeName(normalizedSubdir.split('/').filter(Boolean).pop() ?? 'skill')
        : undefined;
    const path = normalizedSubdir ? `${repoBase}-${subdirLeaf}` : repoBase;
    const skillName = sanitizeName(name ?? subdirLeaf ?? repoBase);
    // Reject re-registration *before* touching the filesystem.
    const manifest = await readManifest();
    if (hasEntry(manifest, skillName) || manifest.skills.some((s) => s.path === path)) {
        process.stderr.write(`A skill named "${skillName}" is already registered (path "${path}").\n` +
            `Use "dsh-skills-nexus update ${skillName}" to refresh it, or "dsh-skills-nexus remove ${skillName}" first.\n`);
        return { status: 'failed' };
    }
    // Check for collisions with manually-placed skills in the official root.
    if (await hasCollision(skillName)) {
        process.stderr.write(`A directory/file named "${skillName}" already exists in ~/.dsh/skills/.\n` +
            `This appears to be manually placed (not a nexus symlink).\n` +
            `Please remove it first or use --name to choose a different name.\n`);
        return { status: 'failed' };
    }
    try {
        const res = await withSkillFileLock(skillName, () => installFromGit({
            spec,
            gitSpec,
            subdir: normalizedSubdir,
            skillName,
            path,
            name,
            subdirLeaf,
            yes,
            io,
        }));
        // `installFromGit` reports `installed`/`skipped`/`failed`; the caller's
        // `added`/`skipped`/`failed` mapping is unchanged (see `AddResult`).
        if (res.status === 'installed')
            return { status: 'added', skillName };
        return res.status === 'skipped' ? { status: 'skipped' } : { status: 'failed' };
    }
    catch (err) {
        if (err instanceof SkillLockedError) {
            process.stderr.write(`${err.message}\n`);
            return { status: 'failed' };
        }
        throw err;
    }
}
/**
 * Re-exported from the shared install core (`src/install.ts`, §10.1): the
 * large-collection guard threshold is part of `add`'s surface — the HTTP mirror
 * in `src/http/routes.ts` reads it from this module — so the name and value
 * stay here although the guard itself now lives in the shared module.
 */
export { LARGE_COLLECTION_THRESHOLD } from '../../install.js';
//# sourceMappingURL=add.js.map
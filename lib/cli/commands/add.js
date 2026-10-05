import { hasEntry, readManifest } from '../../manifest.js';
import { getDefaultBranch, normalizeSubdir, parseGitSpec, repoSlug, sanitizeName, } from '../../git.js';
import { hasCollision } from '../../link.js';
import { installFromGit } from '../../install.js';
import { cliIO } from '../../ops-io.js';
import { withSkillFileLock, SkillLockedError } from '../../locks.js';
import { parseAddArgs } from '../args.js';
import { batchPrefix, withSpinner } from '../progress.js';
import { emitJson, fatalJsonError, jsonIO } from '../json-io.js';
/**
 * `add` — clone one or more git SKILL.md repos and expose each via symlinks
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
    let parsed;
    try {
        parsed = parseAddArgs(argv);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (jsonRequested(argv)) {
            fatalJsonError(io, message);
            return 2;
        }
        io.error(message);
        return 2;
    }
    const { specs, name, ref, subdir, yes, json } = parsed;
    // --name/--ref/--subdir each refine a single repo; they cannot be spread
    // across several specs unambiguously. Refuse explicitly instead of silently
    // applying them to just one (the old "last positional wins" footgun). A JSON
    // run needs the same refusal, and `usage` keeps exit 2 for it (P0 §2.1).
    if (specs.length > 1 && (name || ref || subdir)) {
        const used = [name && '--name', ref && '--ref', subdir && '--subdir']
            .filter(Boolean)
            .join(', ');
        const message = `${used} applies to a single repo and cannot be combined with ${specs.length} repo specs.\n` +
            `Run a separate "dsh-skills-nexus add <repo> ${used}" command per repo to customize each,\n` +
            `or drop the option to install all ${specs.length} repos with their default names.`;
        if (json) {
            fatalJsonError(io, message);
            return 2;
        }
        io.error(message);
        return 1;
    }
    // Machine mode: the shared code's human lines go to a silent sink, so stdout
    // carries the one report and stderr keeps the diagnostics.
    const out = json ? jsonIO(io) : io;
    const multi = specs.length > 1;
    let failures = 0;
    let addedCount = 0;
    const results = [];
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        // Batch counter: only meaningful for multi-repo runs; printed to stdout so
        // non-interactive logs also show which spec is in flight.
        if (multi)
            out.emit(`\n${batchPrefix(i + 1, specs.length)}${spec}\n`);
        try {
            const res = await addOne(spec, { name, ref, subdir, yes }, out);
            if (res.status === 'added')
                addedCount++;
            else
                failures++;
            results.push(toJsonResult(spec, res));
        }
        catch (err) {
            // A thrown error (e.g. clone / network failure) is a per-item failure —
            // isolate it so the remaining specs still get a chance to install.
            failures++;
            const message = err instanceof Error ? err.message : String(err);
            out.error(`✗ ${spec}: ${message}`);
            results.push({ spec, status: 'failed', error: message });
        }
    }
    if (json) {
        const summary = {
            added: results.filter((r) => r.status === 'added').length,
            skipped: results.filter((r) => r.status === 'skipped').length,
            failed: results.filter((r) => r.status === 'failed').length,
        };
        emitJson(io, { version: 1, results, summary });
        return failures === 0 ? 0 : 1;
    }
    if (multi) {
        out.emit(`\n${addedCount}/${specs.length} repo(s) added` +
            (failures > 0 ? `, ${failures} failed` : '') +
            `.\n`);
    }
    return failures === 0 ? 0 : 1;
}
/**
 * One install attempt's structured outcome (P0 §4.2). `added` carries what
 * landed; `skipped`/`failed` carry why — `code` is the install core's
 * `GitInstallFailCode` where the core supplied one, and `error` the
 * preflight's own explanation where the attempt never reached the core
 * (sibling registered, name collision, `--subdir` rejected).
 */
function toJsonResult(spec, res) {
    switch (res.status) {
        case 'added':
            return {
                spec,
                status: 'added',
                name: res.skillName,
                ...(res.commit === undefined ? {} : { commit: res.commit }),
                ...(res.ref === undefined ? {} : { ref: res.ref }),
                ...(res.subdir === undefined ? {} : { subdir: res.subdir }),
                links: res.links,
            };
        case 'skipped':
            return {
                spec,
                status: 'skipped',
                ...(res.code === undefined ? {} : { code: res.code }),
                ...(res.error === undefined ? {} : { error: res.error }),
            };
        default:
            return {
                spec,
                status: 'failed',
                ...(res.code === undefined ? {} : { code: res.code }),
                ...(res.error === undefined ? {} : { error: res.error }),
            };
    }
}
/**
 * True when the argv the parser just rejected asked for the JSON contract, so
 * a usage error still answers in the machine dialect on stderr (P0 §4.6).
 */
function jsonRequested(argv) {
    return argv.some((a) => a === '--json' || a.startsWith('--json='));
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
            const message = err instanceof Error ? err.message : String(err);
            io.error(message);
            return { status: 'failed', error: message };
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
        const message = `A skill named "${skillName}" is already registered (path "${path}").\n` +
            `Use "dsh-skills-nexus update ${skillName}" to refresh it, or "dsh-skills-nexus remove ${skillName}" first.`;
        io.error(message);
        return { status: 'failed', code: 'already-registered', error: message };
    }
    // Check for collisions with manually-placed skills in the official root.
    if (await hasCollision(skillName)) {
        const message = `A directory/file named "${skillName}" already exists in ~/.dsh/skills/.\n` +
            `This appears to be manually placed (not a nexus symlink).\n` +
            `Please remove it first or use --name to choose a different name.`;
        io.error(message);
        return { status: 'failed', code: 'collision', error: message };
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
        // `added`/`skipped`/`failed` mapping is unchanged (see `AddResult`), and
        // its `code` is passed through verbatim for the `--json` report.
        if (res.status === 'installed') {
            return {
                status: 'added',
                skillName,
                ...(res.entry?.commit === undefined ? {} : { commit: res.entry.commit }),
                ...(res.entry?.ref === undefined ? {} : { ref: res.entry.ref }),
                ...(normalizedSubdir === undefined ? {} : { subdir: normalizedSubdir }),
                links: res.links,
            };
        }
        return res.status === 'skipped'
            ? { status: 'skipped', ...(res.code === undefined ? {} : { code: res.code }) }
            : { status: 'failed', ...(res.code === undefined ? {} : { code: res.code }) };
    }
    catch (err) {
        if (err instanceof SkillLockedError) {
            io.error(err.message);
            return { status: 'failed', code: 'locked', error: err.message };
        }
        throw err;
    }
}
/**
 * Re-exported from the shared install core (`src/install.ts`, §10.1): the
 * large-collection guard threshold is part of `add`'s surface, so the name and
 * value are still reachable from this module; `src/http/routes.ts` now imports
 * it straight from `../../install.js` like every other consumer.
 */
export { LARGE_COLLECTION_THRESHOLD } from '../../install.js';
//# sourceMappingURL=add.js.map
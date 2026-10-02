/**
 * The 11 `/skills-nexus/*` routes (§7.1) as plain route specs over an
 * injected request/response surface — tests drive them without a server, and
 * `src/index.ts` owns the single `webServer.register` adaption (§7.4).
 *
 * One response dialect for every route (统一约定): success is
 * `{ data, hotReload }`; failures are `4xx/5xx { error, data? }`. Method
 * mismatches answer `405 + allow`. The mutation/network routes check same
 * origin (§12.1); `remove` additionally requires loopback.
 *
 * Long operations (add / update / switch-version) are accepted as
 * jobs (§7.5): locks are taken at acceptance (受理即锁 — per-skill in-process
 * flight, then the cross-process file lock), the handler answers
 * `202 { data: { jobId } }`, and the work runs in the background. remove /
 * toggle are second-scale local operations and stay synchronous (§7.5).
 *
 * `add` installs through the one shared git core (`src/install.ts`, §10.1):
 * the panel's former `installGitCore` mirror is gone, and its five `400` codes
 * are rebuilt from the core's `GitInstallResult.code`. `add-zip` stays gone
 * (§8 phase 3): zip is no longer an installation method, and the package
 * channel hasn't reached the panel yet (§10.3) — that row is where `import`
 * will live.
 *
 * The route cores call the same shared primitives as the CLI commands but
 * route all messaging through the job's OpsIO — the CLI commands keep their
 * argv/stdout/stderr presentation untouched (full CLI stderr→OpsIO 收编 is a
 * later phase).
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, PLUGIN_ID } from './types.js';
import { JSON_HEADERS, boolField, isLoopback, queryOf, readJson, requireMethod, requireMutationSafe, sendData, sendError, strField, } from './util.js';
import { checkoutRef, discardLocalChanges, getDefaultBranch, getHeadCommit, isDetachedHead, isDirtyWorktree, normalizeSubdir, parseGitSpec, pullRepo, repoSlug, resolveRefCommit, sanitizeName, } from '../git.js';
import { repoDir } from '../paths.js';
import { findEntry, hasEntry, hasGitSource, listEntries, markUpdated, readManifest } from '../manifest.js';
import { entryLinks, hasCollision, linkSkill, unlinkSkill } from '../link.js';
import { removeSkill } from '../remove.js';
import { previewSkills } from '../resolve.js';
import { normalizeSkillName, ensureDescription } from '../frontmatter.js';
import { checkUpdates as healthCheckUpdates } from '../health.js';
import { NotAGitCloneError, RefNotFoundError, SkillNotFoundError, switchVersion as coreSwitchVersion, } from '../switch-version.js';
import { acquireSkillFileLock, SkillBusyError, SkillLockedError, tryClaimSkillFlight, withCacheLock, withSkillFileLock, withSkillFlight, } from '../locks.js';
import { runChecks } from '../cli/commands/doctor.js';
import { installFromGit } from '../install.js';
import { createJob, getJob, requestCancel, runJob } from './jobs.js';
import { quietIO } from './io.js';
/** Every handler runs inside this wrapper: any throw becomes the §7.1 error envelope. */
function wrap(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        }
        catch (err) {
            fail(res, err);
        }
    };
}
function fail(res, err) {
    if (err instanceof HttpError) {
        sendError(res, err.status, err.error, err.data);
        return;
    }
    // §7.3 lock layers map to their two 409 dialects.
    if (err instanceof SkillBusyError) {
        sendError(res, 409, 'busy', { name: err.skill });
        return;
    }
    if (err instanceof SkillLockedError) {
        sendError(res, 409, 'locked', { name: err.skill, lock: err.lock });
        return;
    }
    if (err instanceof SkillNotFoundError) {
        sendError(res, 404, 'not-found');
        return;
    }
    if (err instanceof RefNotFoundError) {
        sendError(res, 400, 'ref-not-found');
        return;
    }
    if (err instanceof NotAGitCloneError) {
        sendError(res, 400, 'not-a-git-clone', { name: err.skillName });
        return;
    }
    process.stderr.write(`[${PLUGIN_ID}] route error: ${err instanceof Error ? err.stack : String(err)}\n`);
    sendError(res, 500, 'internal-error');
}
/**
 * §7.3 layers 1+2 for the synchronous routes: in-process flight (busy) then
 * the cross-process file lock (locked). Both map to 409 via `fail`.
 */
async function lockedFor(name, fn) {
    return withSkillFlight(name, () => withSkillFileLock(name, fn));
}
/**
 * §7.5 受理即锁: claim the flight synchronously (a 409 must be decided before
 * the 202), take the file lock, register the job and answer `202` — the op
 * then runs in the background holding both until `release`.
 */
async function accept(res, kind, name, op) {
    const releaseFlight = tryClaimSkillFlight(name);
    if (releaseFlight === undefined)
        throw new SkillBusyError(name);
    let lock;
    try {
        lock = await acquireSkillFileLock(name);
    }
    catch (err) {
        releaseFlight();
        throw err;
    }
    const job = createJob(kind, name);
    runJob(job, async () => {
        await lock.release();
        releaseFlight();
    }, op);
    sendData(res, { jobId: job.id }, undefined, 202);
}
function short(sha) {
    return sha.slice(0, 7);
}
/* ------------------------------------------------------------------ */
/* GET routes (read-only, §7.1 约定 5)                                 */
/* ------------------------------------------------------------------ */
/** Permanent Phase 0 probe — payload unchanged. */
async function ping(_req, res) {
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({
        data: { name: PLUGIN_ID, status: 'ok', now: new Date().toISOString() },
        hotReload: 'done',
    }));
}
/** §7.2: entries with enabled 反推, per-link state and the runtime update cache. */
async function listRoute(req, res) {
    if (!requireMethod(req, res, 'GET'))
        return;
    const listed = await listEntries();
    const entries = await Promise.all(listed.map(async (l) => ({
        name: l.entry.name,
        url: l.entry.url,
        ref: l.entry.ref,
        subdir: l.entry.subdir ?? null,
        commit: l.entry.commit ?? null,
        // The update/switch buttons are gated on the same predicate the routes
        // themselves use (`400 not-a-git-clone`), so the panel cannot disagree
        // with the server about what is updatable.
        hasGitSource: hasGitSource(l.entry),
        enabled: l.enabled,
        links: await Promise.all(l.links.map(async (link) => {
            let enabled = true;
            try {
                enabled = (await stat(link.target)).isDirectory();
            }
            catch {
                enabled = false;
            }
            return {
                linkName: link.name,
                skillName: await linkSkillName(link.target, link.name),
                enabled,
            };
        })),
        update: l.update,
    })));
    sendData(res, { entries }, 'done');
}
/** Frontmatter name of the skill behind a link; falls back to the link name. */
async function linkSkillName(target, fallback) {
    try {
        const skills = await previewSkills(target);
        return skills[0]?.name || fallback;
    }
    catch {
        return fallback;
    }
}
/** Stable report v1, unchanged — the same JSON `doctor --json` emits. */
async function doctorRoute(req, res) {
    if (!requireMethod(req, res, 'GET'))
        return;
    const report = await runChecks(false, quietIO);
    sendData(res, report, 'done');
}
/** §7.5: `?id=` job status for polling. Read-only → GET. */
async function jobStatus(req, res) {
    if (!requireMethod(req, res, 'GET'))
        return;
    const id = queryOf(req).get('id');
    if (id === null || id === '')
        throw new HttpError(400, 'missing-field', { field: 'id' });
    const job = getJob(id);
    if (job === undefined)
        throw new HttpError(404, 'not-found', { id });
    sendData(res, { job }, 'done');
}
/* ------------------------------------------------------------------ */
/* POST routes — mutations and network                                 */
/* ------------------------------------------------------------------ */
/** POST /add — `{ url, ref?, subdir?, confirm? }` → job (§7.5). */
async function add(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    const body = await readJson(req);
    const spec = strField(body, 'url');
    if (spec === undefined)
        throw new HttpError(400, 'missing-field', { field: 'url' });
    const ref = strField(body, 'ref');
    const subdir = strField(body, 'subdir');
    const yes = boolField(body, 'confirm') === true;
    // Preflight (no writes): the entry name is derived exactly like the CLI does,
    // and the remote's default branch is detected when the caller pinned no ref —
    // the same read-only step `addOne` runs, so the panel never assumes `main`.
    // Like every other preflight failure this one is decided *before* the 202
    // (the CLI answers it with exit 1 for the same reason); the CLI's
    // "Detecting default branch" line is deliberately not reproduced — the job
    // record does not exist yet and the resolved ref shows up in the job's
    // `Cloning <url> (ref: <ref>)` line anyway.
    let gitSpec = parseGitSpec(spec, ref ?? 'main');
    if (ref === undefined && !spec.includes('#')) {
        try {
            gitSpec = { ...gitSpec, ref: await getDefaultBranch(gitSpec.url) };
        }
        catch (err) {
            throw new HttpError(400, 'clone-failed', {
                url: gitSpec.url,
                reason: err instanceof Error ? err.message : String(err),
            });
        }
    }
    let normalizedSubdir;
    if (subdir !== undefined)
        normalizedSubdir = normalizeSubdir(subdir);
    const repoBase = sanitizeName(repoSlug(gitSpec));
    const subdirLeaf = normalizedSubdir
        ? sanitizeName(normalizedSubdir.split('/').filter(Boolean).pop() ?? 'skill')
        : undefined;
    const path = normalizedSubdir !== undefined ? `${repoBase}-${subdirLeaf}` : repoBase;
    const skillName = sanitizeName(subdirLeaf ?? repoBase);
    const manifest = await readManifest();
    if (hasEntry(manifest, skillName) || manifest.skills.some((s) => s.path === path)) {
        throw new HttpError(409, 'already-registered', { name: skillName });
    }
    if (await hasCollision(skillName)) {
        throw new HttpError(409, 'collision', { name: skillName });
    }
    // The install phase itself is the one shared core (§10.1) — the panel runs
    // the very code the CLI runs, under the per-skill flight + file lock that
    // `accept` takes at acceptance time.
    await accept(res, 'add', skillName, async (io) => {
        const result = await installFromGit({
            spec,
            gitSpec,
            subdir: normalizedSubdir,
            skillName,
            path,
            name: undefined,
            subdirLeaf,
            yes,
            io,
        });
        // `installFromGit` reports why it stopped; the five codes the panel used to
        // throw are rebuilt here so the client sees the same §10.4 dialect.
        if (result.status === 'failed' || result.status === 'skipped') {
            throw new HttpError(400, result.code ?? 'install-failed', { name: skillName });
        }
    });
}
/** POST /remove — `{ name, confirm: true }`, synchronous; loopback + same-origin. */
async function remove(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    if (!isLoopback(req)) {
        sendError(res, 403, 'loopback only');
        return;
    }
    const body = await readJson(req);
    const name = strField(body, 'name');
    if (name === undefined)
        throw new HttpError(400, 'missing-field', { field: 'name' });
    requireConfirm(res, body, `Remove "${name}"? This permanently deletes the local clone and its links.`);
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (entry === undefined)
        throw new HttpError(404, 'not-found', { name });
    const removedLinks = await lockedFor(name, async () => {
        // Deletion lives in src/remove.ts — one core shared with the CLI `remove`
        // command, so both faces derive the same link names (the v0.3.0 by-name
        // scheme) instead of drifting apart. Unregister → unlink → drop the clone
        // happens inside, in that order.
        const result = await removeSkill(name);
        if (!result.removed)
            throw new HttpError(404, 'not-found', { name });
        return result.links;
    });
    // §11: only an actual link deletion wakes the host watcher — a link-less
    // removal settles as 'done' and the UI skips reconciliation.
    sendData(res, { name, removed: true, links: removedLinks }, removedLinks.length > 0 ? 'pending' : 'done');
}
/** POST /update — `{ name, confirm: true }` → job (§8.1 分流). */
async function updateRoute(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    const body = await readJson(req);
    const name = strField(body, 'name');
    if (name === undefined)
        throw new HttpError(400, 'missing-field', { field: 'name' });
    requireConfirm(res, body, `Update "${name}"? Local changes in the clone will be discarded (reset --hard + clean -fd).`);
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (entry === undefined)
        throw new HttpError(404, 'not-found', { name });
    if (!hasGitSource(entry))
        throw new HttpError(400, 'not-a-git-clone', { name });
    await accept(res, 'update', name, (io) => updateEntryCore(entry, io));
}
/** POST /check-updates — network comparison, results only in the runtime cache (§5.2). */
async function checkUpdatesRoute(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    const results = await withCacheLock(() => healthCheckUpdates(undefined, quietIO));
    sendData(res, { results }, 'done');
}
/** POST /switch-version — `{ name, ref, refType? }` → job (§8.2). */
async function switchVersionRoute(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    const body = await readJson(req);
    const name = strField(body, 'name');
    const ref = strField(body, 'ref');
    if (name === undefined)
        throw new HttpError(400, 'missing-field', { field: 'name' });
    if (ref === undefined)
        throw new HttpError(400, 'missing-field', { field: 'ref' });
    const refType = strField(body, 'refType');
    if (refType !== undefined && refType !== 'branch' && refType !== 'tag' && refType !== 'commit') {
        throw new HttpError(400, 'invalid-ref-type', { refType });
    }
    requireConfirm(res, body, `Switch "${name}" to ${ref}? Local changes will be discarded and the frontmatter re-normalized.`);
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (entry === undefined)
        throw new HttpError(404, 'not-found', { name });
    if (!hasGitSource(entry))
        throw new HttpError(400, 'not-a-git-clone', { name });
    await accept(res, 'switch-version', name, async (io) => {
        const result = await coreSwitchVersion(name, ref, refType, io);
        io.emit(`  ✓ ${short(result.before)} → ${short(result.after)} (${result.kind})\n`);
    });
}
/** POST /toggle — `{ name, enabled }`, synchronous, target-attribution semantics (§6.4). */
async function toggleRoute(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    const body = await readJson(req);
    const name = strField(body, 'name');
    const enabled = boolField(body, 'enabled');
    if (name === undefined)
        throw new HttpError(400, 'missing-field', { field: 'name' });
    if (enabled === undefined)
        throw new HttpError(400, 'missing-field', { field: 'enabled' });
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (entry === undefined)
        throw new HttpError(404, 'not-found', { name });
    const { changed, ...data } = await lockedFor(name, () => toggleEntryCore(entry, enabled));
    // §11: a no-op toggle (nothing to build or remove) leaves the watcher
    // silent — 'done'; an actual link build/removal is 'pending'.
    sendData(res, data, changed ? 'pending' : 'done');
}
/** POST /job/cancel — `{ id }` best-effort cancellation (§7.5). */
async function jobCancel(req, res) {
    if (!requireMethod(req, res, 'POST'))
        return;
    if (!requireMutationSafe(req, res))
        return;
    const body = await readJson(req);
    const id = strField(body, 'id');
    if (id === undefined)
        throw new HttpError(400, 'missing-field', { field: 'id' });
    const job = requestCancel(id);
    if (job === undefined)
        throw new HttpError(404, 'not-found', { id });
    sendData(res, { id: job.id, status: job.status }, 'done');
}
/* ------------------------------------------------------------------ */
/* Confirmation gate (§7.1 约定 4 / §12.2)                             */
/* ------------------------------------------------------------------ */
function requireConfirm(res, body, question) {
    if (boolField(body, 'confirm') === true)
        return;
    throw new HttpError(409, 'confirm-required', { question });
}
/* ------------------------------------------------------------------ */
/* Cores (shared primitives, OpsIO for all messaging)                  */
/*                                                                     */
/* `add` is not here: its install phase is the one shared core in      */
/* `src/install.ts` (§10.1). update / toggle are still panel-side      */
/* mirrors of their CLI commands and are deliberately out of scope.    */
/* ------------------------------------------------------------------ */
/**
 * The per-entry update body, mirroring `update.ts` (§8.1 分流): discard →
 * pull (branch) or verify/restore (detached) → re-normalize → re-link when
 * previously linked → markUpdated.
 */
async function updateEntryCore(entry, io) {
    const dir = repoDir(entry.path);
    const before = await getHeadCommit(dir);
    let after;
    if (await isDirtyWorktree(dir)) {
        io.emit('  ⚠ discarding local changes in nexus-managed clone\n');
        await discardLocalChanges(dir);
    }
    if (await isDetachedHead(dir)) {
        const want = await resolveRefCommit(dir, entry.ref);
        if (before !== want) {
            await checkoutRef(dir, entry.ref);
            after = await getHeadCommit(dir);
            io.emit(`  ✓ restored to pinned ${short(after)}\n`);
        }
        else {
            after = before;
            io.emit(`  ✓ pinned at ${short(after)} — nothing to update\n`);
        }
    }
    else {
        io.progress('pulling', entry.name);
        await pullRepo(dir);
        after = await getHeadCommit(dir);
        io.emit(after === before
            ? `  ✓ up to date (${short(after)})\n`
            : `  ✓ ${short(before)} → ${short(after)}\n`);
    }
    // §8.1: pull 之后仍须重建链接 — upstream may have renamed or added skills.
    const skillRoot = entry.subdir !== undefined ? join(dir, entry.subdir) : dir;
    const skills = await previewSkills(skillRoot);
    for (const ps of skills) {
        const validName = ps.invalidName ? sanitizeName(ps.invalidName) : ps.name || entry.name;
        if (ps.invalidName) {
            await normalizeSkillName(ps.skillFile, validName);
            io.emit(`  ⚠ re-normalized name: "${ps.invalidName}" → "${validName}"\n`);
        }
        if (!ps.description || ps.description.trim().length === 0) {
            await ensureDescription(ps.skillFile, validName);
            io.emit(`  ⚠ added missing description for "${validName}"\n`);
        }
    }
    // Rebuild the way the CLI does (record -> unlink -> relink): a link kept
    // under a name upstream dropped would either surface the same SKILL.md under
    // two names or dangle once its skill directory is gone, and a later `remove`
    // (which derives names from the current clone) could not clean it up either.
    // Like switch-version (§8.2 step 6), an entry with no attributed links is
    // disabled and must not be silently re-enabled.
    const oldLinks = await entryLinks(entry);
    for (const l of oldLinks)
        await unlinkSkill(l.name);
    if (oldLinks.length > 0) {
        const rebuilt = new Set();
        for (const ps of skills) {
            const fmName = ps.invalidName ? sanitizeName(ps.invalidName) : ps.name;
            const linkName = skills.length === 1 ? entry.name : fmName || entry.name;
            await linkSkill(linkName, ps.resourceBase);
            rebuilt.add(linkName);
        }
        const dropped = oldLinks.map((l) => l.name).filter((n) => !rebuilt.has(n));
        if (dropped.length > 0) {
            io.emit(`  ⚠ dropped ${dropped.length} stale link(s) no longer provided upstream: ${dropped.join(', ')}\n`);
        }
    }
    await markUpdated(entry.name, after);
}
/**
 * §6.4 Phase 2 target-attribution semantics: disable removes every link whose
 * readlink target lies inside the entry's clone; enable rebuilds the missing
 * links only, guarded by the collision check (never overwrite a manually
 * placed directory).
 */
async function toggleEntryCore(entry, enabled) {
    let changed = false;
    if (enabled) {
        const existing = new Set((await entryLinks(entry)).map((l) => l.name));
        const dir = repoDir(entry.path);
        const skillRoot = entry.subdir !== undefined ? join(dir, entry.subdir) : dir;
        const skills = await previewSkills(skillRoot);
        for (const s of skills) {
            const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name;
            const linkName = skills.length === 1 ? entry.name : fmName || entry.name;
            if (existing.has(linkName))
                continue;
            if (await hasCollision(linkName)) {
                throw new HttpError(409, 'collision', { name: linkName });
            }
            await linkSkill(linkName, s.resourceBase);
            changed = true;
        }
    }
    else {
        for (const l of await entryLinks(entry)) {
            await unlinkSkill(l.name);
            changed = true;
        }
    }
    const final = await entryLinks(entry);
    return {
        name: entry.name,
        enabled: final.length > 0,
        links: final.map((l) => ({ linkName: l.name, enabled: true })),
        changed,
    };
}
/* ------------------------------------------------------------------ */
/* Route table (§7.1)                                                  */
/* ------------------------------------------------------------------ */
export function createNexusRoutes() {
    return [
        { kind: 'exact', path: '/skills-nexus/ping', handler: wrap(ping) },
        { kind: 'exact', path: '/skills-nexus/list', handler: wrap(listRoute) },
        { kind: 'exact', path: '/skills-nexus/doctor', handler: wrap(doctorRoute) },
        { kind: 'exact', path: '/skills-nexus/add', handler: wrap(add) },
        { kind: 'exact', path: '/skills-nexus/remove', handler: wrap(remove) },
        { kind: 'exact', path: '/skills-nexus/update', handler: wrap(updateRoute) },
        { kind: 'exact', path: '/skills-nexus/check-updates', handler: wrap(checkUpdatesRoute) },
        { kind: 'exact', path: '/skills-nexus/switch-version', handler: wrap(switchVersionRoute) },
        { kind: 'exact', path: '/skills-nexus/toggle', handler: wrap(toggleRoute) },
        { kind: 'exact', path: '/skills-nexus/job', handler: wrap(jobStatus) },
        { kind: 'exact', path: '/skills-nexus/job/cancel', handler: wrap(jobCancel) },
    ];
}
//# sourceMappingURL=routes.js.map
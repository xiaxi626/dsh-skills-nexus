/**
 * Three-layer concurrency control (§7.3) for nexus write operations.
 *
 * The CLI and the plugin's HTTP routes run in *different processes*, and both
 * mutate the same clones, links and manifest — so no single mechanism is
 * enough:
 *
 *   1. `withSkillFlight`   — per-skill in-process single flight. Two writes
 *     for the same name inside one process (HTTP route handlers) never
 *     overlap; a conflicting second call is rejected with `SkillBusyError`
 *     (the route maps it to `409 busy`, dsh-research installing-lock style).
 *   2. `withCacheLock`     — one global in-process mutex around the runtime
 *     update cache (§5.2): `check-updates` writes it while `list` reads it.
 *   3. `withSkillFileLock` — cross-process mutual exclusion via
 *     `<NEXUS_HOME>/.locks/<name>.lock` created with `O_EXCL` (`wx`), body
 *     `{ pid, startedAt }`. A held lock whose PID no longer exists, whose
 *     timestamp is older than 10 minutes, or whose content is unreadable is
 *     reclaimed with exactly one retry; anything else is `SkillLockedError`
 *     (CLI exit 1 / HTTP `409 locked`). The manifest keeps its existing
 *     atomic tmp+rename write — the file lock only fences git operations
 *     and link create/delete.
 */
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCKS_DIR } from './paths.js';
/** Layer-1 conflict: the same skill already has a write in flight in this process. */
export class SkillBusyError extends Error {
    skill;
    constructor(skill) {
        super(`skill "${skill}" is busy with another operation in this process`);
        this.skill = skill;
        this.name = 'SkillBusyError';
    }
}
/** Layer-3 conflict: another (live) process holds the skill's lock file. */
export class SkillLockedError extends Error {
    skill;
    lock;
    constructor(skill, lock) {
        super(`skill "${skill}" is locked by another process (pid ${lock.pid}, since ${lock.startedAt})`);
        this.skill = skill;
        this.lock = lock;
        this.name = 'SkillLockedError';
    }
}
/* ------------------------------------------------------------------ */
/* Layer 1 — per-skill in-process single flight                        */
/* ------------------------------------------------------------------ */
const flights = new Map();
/**
 * Run `fn` as the only in-process write for `skill`. A concurrent second call
 * for the same skill throws `SkillBusyError` instead of queueing.
 */
export async function withSkillFlight(skill, fn) {
    if (flights.has(skill))
        throw new SkillBusyError(skill);
    const running = fn();
    flights.set(skill, running);
    try {
        return await running;
    }
    finally {
        if (flights.get(skill) === running)
            flights.delete(skill);
    }
}
/**
 * Synchronously claim the in-process slot for `skill` and hold it until the
 * returned release function is called — the shape the HTTP job channel needs
 * (受理即锁, §7.5): the handler must know *before* answering `202` whether the
 * skill is already busy. Returns `undefined` when the slot is taken.
 */
export function tryClaimSkillFlight(skill) {
    if (flights.has(skill))
        return undefined;
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    flights.set(skill, gate);
    void gate.then(() => {
        if (flights.get(skill) === gate)
            flights.delete(skill);
    });
    return release;
}
/* ------------------------------------------------------------------ */
/* Layer 2 — global runtime-cache lock                                 */
/* ------------------------------------------------------------------ */
let cacheChain = Promise.resolve();
/** Serialize `fn` against all other cache-lock users, regardless of outcome. */
export function withCacheLock(fn) {
    const run = cacheChain.then(() => fn());
    cacheChain = run.then(() => undefined, () => undefined);
    return run;
}
/** A lock older than this is stale even if its PID still exists (§7.3). */
export const LOCK_STALE_MS = 10 * 60 * 1000;
function lockFilePath(skill) {
    // Defense in depth: entry names are generated slugs, but a hand-written
    // manifest could contain path separators — never let one escape .locks/.
    const safe = skill.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(LOCKS_DIR, `${safe}.lock`);
}
/**
 * Acquire the cross-process lock for `skill`, or throw `SkillLockedError`.
 * Stale locks (dead PID, older than `LOCK_STALE_MS`, or unreadable content)
 * are reclaimed with exactly one retry before giving up (§7.3).
 */
export async function acquireSkillFileLock(skill) {
    await mkdir(LOCKS_DIR, { recursive: true });
    const path = lockFilePath(skill);
    const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
    if (await tryCreateLock(path, body))
        return makeLock(skill, path);
    const info = await readLock(path);
    const stale = info === undefined ||
        !isPidAlive(info.pid) ||
        Date.now() - Date.parse(info.startedAt) > LOCK_STALE_MS;
    if (stale) {
        // Reclaim and retry exactly once.
        await unlink(path).catch(() => undefined);
        if (await tryCreateLock(path, body))
            return makeLock(skill, path);
    }
    throw new SkillLockedError(skill, info ?? { pid: 0, startedAt: 'unknown' });
}
/** Convenience: run `fn` while holding the skill's cross-process lock. */
export async function withSkillFileLock(skill, fn) {
    const lock = await acquireSkillFileLock(skill);
    try {
        return await fn();
    }
    finally {
        await lock.release();
    }
}
async function tryCreateLock(path, body) {
    try {
        const handle = await open(path, 'wx'); // O_EXCL — fail if it already exists
        try {
            await handle.writeFile(body, 'utf8');
        }
        finally {
            await handle.close();
        }
        return true;
    }
    catch (err) {
        if (err.code === 'EEXIST')
            return false;
        throw err;
    }
}
async function readLock(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') {
            return { pid: parsed.pid, startedAt: parsed.startedAt };
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * PID liveness probe. `process.kill(pid, 0)` asks the OS for the process
 * object without signalling it: `ESRCH` means gone; `EPERM` means alive but
 * not ours (treated as alive — caution wins over a false reclaim).
 */
function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === 'EPERM';
    }
}
function makeLock(skill, path) {
    let released = false;
    return {
        skill,
        async release() {
            if (released)
                return;
            released = true;
            await unlink(path).catch(() => undefined);
        },
    };
}
//# sourceMappingURL=locks.js.map
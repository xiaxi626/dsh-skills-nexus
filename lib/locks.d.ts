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
/** Layer-1 conflict: the same skill already has a write in flight in this process. */
export declare class SkillBusyError extends Error {
    readonly skill: string;
    constructor(skill: string);
}
/** Layer-3 conflict: another (live) process holds the skill's lock file. */
export declare class SkillLockedError extends Error {
    readonly skill: string;
    readonly lock: {
        pid: number;
        startedAt: string;
    };
    constructor(skill: string, lock: {
        pid: number;
        startedAt: string;
    });
}
/**
 * Run `fn` as the only in-process write for `skill`. A concurrent second call
 * for the same skill throws `SkillBusyError` instead of queueing.
 */
export declare function withSkillFlight<T>(skill: string, fn: () => Promise<T>): Promise<T>;
/**
 * Synchronously claim the in-process slot for `skill` and hold it until the
 * returned release function is called — the shape the HTTP job channel needs
 * (受理即锁, §7.5): the handler must know *before* answering `202` whether the
 * skill is already busy. Returns `undefined` when the slot is taken.
 */
export declare function tryClaimSkillFlight(skill: string): (() => void) | undefined;
/** Serialize `fn` against all other cache-lock users, regardless of outcome. */
export declare function withCacheLock<T>(fn: () => Promise<T>): Promise<T>;
export interface SkillFileLock {
    readonly skill: string;
    release(): Promise<void>;
}
/** A lock older than this is stale even if its PID still exists (§7.3). */
export declare const LOCK_STALE_MS: number;
/**
 * Acquire the cross-process lock for `skill`, or throw `SkillLockedError`.
 * Stale locks (dead PID, older than `LOCK_STALE_MS`, or unreadable content)
 * are reclaimed with exactly one retry before giving up (§7.3).
 */
export declare function acquireSkillFileLock(skill: string): Promise<SkillFileLock>;
/** Convenience: run `fn` while holding the skill's cross-process lock. */
export declare function withSkillFileLock<T>(skill: string, fn: () => Promise<T>): Promise<T>;
/**
 * Run `fn` while holding the cross-process manifest lock.
 *
 * Every manifest read-modify-write MUST go through this wrapper so that
 * concurrent CLI and HTTP processes cannot clobber each other's entries.
 * The lock is released whether `fn` succeeds or throws.
 */
export declare function withManifestLock<T>(fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=locks.d.ts.map
/**
 * In-process update-check cache (§5.2) — deliberately NOT persisted.
 *
 * The HTTP `check-updates` route (Phase 2) compares each branch-pinned entry
 * against its remote and records the result here; `GET /list` (and
 * `listEntries()` in between) merges it into the response as the UI badge
 * data source. The cache dies with the process: a badge always means "last
 * checked at `checkedAt`", never a second truth source next to the manifest.
 *
 * Lives in its own module (rather than `src/index.ts` as the plan sketched)
 * because the writers (health.ts `checkUpdates`) and readers (manifest.ts
 * `listEntries`) both need it, and both already participate in import chains
 * that a shared cell would otherwise turn into a cycle.
 */
/**
 * The per-entry check result — exactly the `update` object of the list route
 * (§7.2). `latestCommit` is null when the remote could not be resolved.
 */
export interface UpdateStatus {
    hasUpdate: boolean;
    latestCommit: string | null;
    checkedAt: string;
}
/** Record a fresh comparison result for `name` (last write wins). */
export declare function setUpdateStatus(name: string, status: UpdateStatus): void;
/** The last recorded result for `name`, or undefined if never checked. */
export declare function getUpdateStatus(name: string): UpdateStatus | undefined;
//# sourceMappingURL=update-cache.d.ts.map
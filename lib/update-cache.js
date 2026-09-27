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
/** Keyed by entry name (the manifest management key). Process-lifetime only. */
const updateCache = new Map();
/** Record a fresh comparison result for `name` (last write wins). */
export function setUpdateStatus(name, status) {
    updateCache.set(name, status);
}
/** The last recorded result for `name`, or undefined if never checked. */
export function getUpdateStatus(name) {
    return updateCache.get(name);
}
//# sourceMappingURL=update-cache.js.map
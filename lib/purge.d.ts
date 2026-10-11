/**
 * Purge accumulated artifacts that are safe to delete but have no automatic
 * cleanup mechanism.
 *
 * Four categories of residue grow over time:
 *   1. `exports/*.zip`         — every `export` writes a new archive; old ones
 *                                are never garbage-collected.
 *   2. `manifest.json.corrupt-*` — the atomic-write backup from a corrupt
 *                                manifest read; each corruption event leaves
 *                                one behind.
 *   3. `upload-*`              — temporary directories created during package
 *                                import; a crash between `mkdir` and `rm`
 *                                leaves them orphaned.
 *   4. `rollback/<name>.json`  — recovery points for removed skills. Active
 *                                skills' rollback files are *not* touched:
 *                                they still serve `rollback <name>`.
 *
 * The default mode is a dry-run: scan and report, but delete nothing. This is
 * deliberate — the artifacts are harmless leftovers, and a user who runs
 * `purge` without `--yes` gets a preview of what *would* go. Actual deletion
 * requires an explicit `--yes`, the same guard pattern as `remove` with
 * multi-match globs.
 */
/**
 * mtime 保护窗口：最近 24 小时内修改过的候选目录不被 purge 清除。
 *
 * 一个刚被 `git fetch` / `git pull` / 手动 checkout touched 的目录，其
 * mtime 是新鲜的，但 manifest 可能因为别的原因（手动编辑、另一个进程的
 * 并发操作）不再引用它——直接删除会丢失用户刚做的工作。24 小时足以覆盖
 * "今天刚用过"的场景，同时不会让真正的孤儿目录长期驻留。
 */
export declare const PURGE_MTIME_GUARD_MS: number;
/** One file the purge scan identified, with its size in bytes. */
export interface PurgeableItem {
    /** Absolute path of the file or directory to remove. */
    path: string;
    /** Size in bytes (for directories, the sum of all descendants). */
    size: number;
    /** Which category this item belongs to — feeds the JSON report. */
    category: 'exports' | 'corrupt-manifest' | 'upload-temp' | 'orphan-rollback';
}
/**
 * Scan the four artifact categories and return every purgeable item.
 *
 * Exported for the CLI's dry-run and the `--json` report. Pure scan — no
 * side effects, nothing is deleted.
 */
export declare function scanPurgeable(): Promise<PurgeableItem[]>;
/**
 * Result of {@link executePurge}: what was actually deleted and what the mtime
 * guard spared.
 */
export interface PurgeResult {
    /** Items successfully removed. */
    removed: PurgeableItem[];
    /**
     * Items spared because their mtime falls within the protection window.
     * The caller can surface these so the user knows they exist but were kept.
     */
    skippedRecent: PurgeableItem[];
}
/**
 * Delete every item the scan returned. Errors are swallowed per-item so one
 * stubborn file does not abort the rest — the caller reports what was
 * actually removed via the return value.
 *
 * Items whose mtime falls within {@link PURGE_MTIME_GUARD_MS} of now are
 * spared: a directory touched in the last 24 hours is likely still in active
 * use, even if no manifest entry currently references it. `stat` failure
 * (directory vanished between scan and delete) does NOT trigger the guard —
 * `catch(() => undefined)` falls through to the normal `rm` path, which will
 * also fail and be swallowed by the per-item try/catch.
 */
export declare function executePurge(items: PurgeableItem[]): Promise<PurgeResult>;
//# sourceMappingURL=purge.d.ts.map
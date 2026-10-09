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
 * Delete every item the scan returned. Errors are swallowed per-item so one
 * stubborn file does not abort the rest — the caller reports what was
 * actually removed via the return value.
 */
export declare function executePurge(items: PurgeableItem[]): Promise<PurgeableItem[]>;
//# sourceMappingURL=purge.d.ts.map
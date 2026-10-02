import type { EntryLink } from './link.js';
import type { UpdateStatus } from './update-cache.js';
import type { Manifest, SkillEntry } from './types.js';
/** Read the manifest, returning an empty one if it does not exist yet. */
export declare function readManifest(): Promise<Manifest>;
/**
 * Persist the manifest atomically: write a temp file in the same directory,
 * then rename it over the live manifest. The live file is never truncated in
 * place, so an interrupted write leaves either the old or the new *complete*
 * manifest — never an empty/half-written one. The fixed temp name is reused
 * (truncated) on the next write, so a crash between the write and the rename
 * leaves at most one harmless orphan that self-heals; it sits beside
 * manifest.json inside NEXUS_HOME and never touches repos/ or the project tree.
 */
export declare function writeManifest(manifest: Manifest): Promise<void>;
/** Find a skill entry by its management name. */
export declare function findEntry(manifest: Manifest, name: string): SkillEntry | undefined;
/** True if a name (or path) is already taken in the manifest. */
export declare function hasEntry(manifest: Manifest, name: string): boolean;
/**
 * True when the entry has a git source — a remote URL was recorded at install
 * time. Entries without one (archive imports, hand-written snapshots) can be
 * listed, toggled and removed, but there is no history to fetch, update or
 * switch: every git-bound path refuses them explicitly instead of running git
 * in a directory that has no repository.
 */
export declare function hasGitSource(entry: SkillEntry): boolean;
/** Append a new entry and persist. Throws on duplicate name/path. */
export declare function addEntry(entry: SkillEntry): Promise<void>;
/** Remove an entry by name and persist. Returns the removed entry, if any. */
export declare function removeEntry(name: string): Promise<SkillEntry | undefined>;
/**
 * Stamp `updatedAt` after a successful update — plus the resolved commit
 * ("lockfile-lite": the manifest always knows the exact installed version)
 * and, for `switch-version`, the newly checked-out ref (§8.2 step 7).
 */
export declare function markUpdated(name: string, commit?: string, ref?: string): Promise<void>;
/** Best-effort recursive delete of a skill's cloned directory. */
export declare function removeSkillDir(path: string): Promise<void>;
/**
 * One manifest entry as the `list` route needs it (§7.2): the stored entry
 * plus its derived runtime state —
 *   - `enabled` / `links` — reverse-inferred from the symlinks in the
 *     official skills root, never persisted (§5.1/§6.4);
 *   - `update` — the last network comparison from the runtime cache (§5.2),
 *     `null` when the entry was never checked (pinned and zip entries are
 *     never written to the cache, so they stay `null` too).
 */
export interface ListedEntry {
    entry: SkillEntry;
    /** True when at least one symlink points into the entry's clone (§6.4). */
    enabled: boolean;
    /** Every symlink currently pointing into this entry, in FS name order. */
    links: EntryLink[];
    /** Last check-updates result (runtime cache), or null when never checked. */
    update: UpdateStatus | null;
}
/**
 * Read the manifest and merge each entry's derived state (§6.3) — the thin
 * core behind `GET /skills-nexus/list`. Read-only: nothing is persisted, and
 * a missing/corrupt manifest degrades to an empty list like `readManifest`.
 */
export declare function listEntries(): Promise<ListedEntry[]>;
//# sourceMappingURL=manifest.d.ts.map
/**
 * Channel E — external entry core for the trae-cn link channel.
 *
 * Provides the ability to discover skills from external sources (currently
 * trae-cn's local skill directories) and register them as manifest entries
 * that merely symlink to directories the user already owns. Nexus never
 * clones, fetches, updates or deletes those directories — it only manages
 * the manifest records and the symlinks in `~/.dsh/skills/`.
 *
 * The key abstraction is `entrySkillDir`: every read path that used to
 * compute `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`
 * now calls this single function, which redirects external entries to their
 * `externalDir` instead. Without it, external entries would be invisible to
 * toggle, health, list and link scanning.
 */
import type { SkillEntry } from './types.js';
import type { OpsIO } from './ops-io.js';
/**
 * Return the absolute path to the skill root directory for any entry.
 *
 * - **external** entries → `entry.externalDir` (the user-owned directory).
 * - **managed** entries → the existing ternary:
 *   `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`.
 *
 * Implementation discipline: the managed branch must remain byte-for-byte
 * equivalent to the ternary formerly inlined in toggle.ts, routes.ts and
 * remove.ts, so no managed entry regresses.
 */
export declare function entrySkillDir(entry: SkillEntry): string;
/** Fixed subdirectories scanned under the trae-cn root. */
export declare const TRAE_CN_SUBDIRS: readonly ["skills"];
/** Machine-readable codes for link-channel failures (§10.4 dialect). */
export type LinkErrorCode = 'not-found' | 'not-a-skill-dir' | 'already-exists' | 'resolve-failed' | 'name-collision';
/** A link-channel operation was refused or failed. */
export declare class LinkError extends Error {
    readonly code: LinkErrorCode;
    constructor(code: LinkErrorCode, message: string);
}
/** Options accepted by `planLinkLocal` and `linkLocal`. */
export interface LinkOptions {
    /** Override the trae-cn root directory (env TRAE_CN_DIR takes precedence). */
    traeCnDir?: string;
    /** Override the L1 group name (default = source value, currently 'trae-cn'). */
    group?: string;
    /** Bypass name-collision checks and overwrite existing entries. */
    force?: boolean;
}
/** One skill discovered under the trae-cn root. */
export interface DiscoveredSkill {
    /** Which fixed subdir it was found in (currently always 'skills'). */
    subdir: string;
    /** Directory name within that subdir. */
    name: string;
    /** Absolute path to the skill directory. */
    dir: string;
    /** Frontmatter `name` field (for display / conflict diagnostics). */
    skillName: string;
}
/** One planned entry — what `linkLocal` would create. */
export interface LinkPlanEntry {
    /** Flat management name = `groupPath.join('.')`. */
    name: string;
    /** Hierarchical group path, e.g. `['trae-cn', 'skills', 'brainstorming']`. */
    groupPath: string[];
    /** Absolute path to the external skill directory. */
    externalDir: string;
    /** Frontmatter skill name (for display). */
    skillName: string;
}
/** The full preview — every planned entry plus any name collisions. */
export interface LinkPlan {
    /** Source identifier (currently always 'trae-cn'). */
    source: string;
    /** Entries that would be (or were) created. */
    entries: LinkPlanEntry[];
    /** Names that already exist in the manifest (skipped unless `--force`). */
    conflicts: string[];
}
/** The outcome of a `linkLocal` execution. */
export interface LinkResult {
    /** Flat names that were actually added. */
    added: string[];
    /** Flat names skipped due to conflicts (present even without `--force`). */
    skipped: string[];
}
/**
 * Locate the trae-cn skills root.
 *
 * Priority: `opts.traeCnDir` > `TRAE_CN_DIR` env > `~/.trae-cn`.
 * Throws `LinkError('not-found')` when the resolved directory does not exist.
 */
export declare function resolveTraeCnRoot(opts?: {
    traeCnDir?: string;
}): string;
/** Async variant that verifies the directory exists. */
export declare function assertTraeCnRoot(opts?: {
    traeCnDir?: string;
}): Promise<string>;
/**
 * Discover every skill under the trae-cn root's fixed subdirectory
 * (`TRAE_CN_SUBDIRS`, currently just `skills/`).
 *
 * For each subdir in `TRAE_CN_SUBDIRS`, scans one level deep for directories
 * containing a `SKILL.md` file. Returns a flat list of `DiscoveredSkill`
 * records with the frontmatter name (used for display and conflict
 * diagnostics).
 */
export declare function discoverTraeCnSkills(root: string): Promise<DiscoveredSkill[]>;
/**
 * Build a link plan without creating anything.
 *
 * `source` identifies the external source — currently only `'trae-cn'` is
 * accepted; any other value throws a `LinkError` (reserved for future
 * extension to qoder and other sources).
 *
 * The plan contains one entry per discovered skill, with:
 *   - `groupPath` = `[group ?? source, subdir, dirName]`
 *   - `name` = `groupPath.join('.')`
 *   - `externalDir` = absolute path to the skill directory
 *
 * Names that already exist in the manifest are reported as conflicts.
 */
export declare function planLinkLocal(source: string, opts?: LinkOptions): Promise<LinkPlan>;
/**
 * Execute the link plan: write manifest entries and create symlinks.
 *
 * For each planned entry:
 *   1. Construct a `SkillEntry` with `ownership: 'external'`, `externalDir`,
 *      and `groupPath`.
 *   2. Add it to the manifest via `addEntry`.
 *   3. Create a symlink in `~/.dsh/skills/<flat-name>` → `externalDir`.
 *
 * Returns the plan plus the result (which entries were added / skipped).
 */
export declare function linkLocal(source: string, opts?: LinkOptions, io?: OpsIO): Promise<{
    plan: LinkPlan;
    result: LinkResult;
}>;
//# sourceMappingURL=external.d.ts.map
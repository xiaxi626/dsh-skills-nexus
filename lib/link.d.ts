import type { SkillEntry } from './types.js';
/**
 * Manage symlinks that expose cloned skills to the official DSH skills root.
 *
 * The official filesystem provider only scans one level deep under
 * `~/.dsh/skills/`, so nexus creates one symlink per discovered skill at the
 * top level. This way:
 *   - The official provider handles discovery, watching, and error tolerance.
 *   - Nexus still manages git clones, subdir installs, and collection repos.
 *   - enable/disable is just create/remove symlink — lightweight and atomic.
 */
/** True if a symlink (or directory) exists at the official skill path. */
export declare function isLinked(skillName: string): Promise<boolean>;
/** One symlink that belongs to an entry: its name and resolved target path. */
export interface EntryLink {
    /** Symlink name under the official skills root. */
    name: string;
    /** Absolute resolved target — inside the entry's clone (or one of its subdirs). */
    target: string;
}
/**
 * All symlinks in the official skills root whose target resolves inside the
 * entry's clone (or one of its subdirs) — the entry↔link one-to-many
 * relation (§6.4).
 *
 * State is looked up by link *target*, not by name: multi-skill repos create
 * one symlink per discovered skill (named after each skill's frontmatter),
 * so no symlink ever carries the entry name. A name-based `isLinked(entry.name)`
 * reported such entries as disabled even while all of their skills were
 * linked — breaking `list`, the `disable` early-return, and the default
 * `update` target filter. Scanning targets works for single- and multi-skill
 * repos alike and does not require the clone to be present.
 */
export declare function entryLinks(entry: SkillEntry): Promise<EntryLink[]>;
/**
 * True when the entry is enabled — at least one symlink points into its
 * clone. Thin wrapper over `entryLinks`, the single target-ownership scanner.
 */
export declare function isEntryEnabled(entry: SkillEntry): Promise<boolean>;
/**
 * Create a symlink in the official skills root pointing to `targetDir`.
 *
 * If a symlink already exists at the same name it is replaced atomically
 * (unlink then symlink). Parent directories are created as needed.
 */
export declare function linkSkill(skillName: string, targetDir: string): Promise<void>;
/** Remove a skill's symlink from the official skills root. */
export declare function unlinkSkill(skillName: string): Promise<void>;
/**
 * Remove the symlink at `linkPath` when its readlink target resolves into
 * `dir` (or equals it) — the §6.4 target-attribution unlink. Returns true
 * iff a link was removed; a missing path, a non-symlink, or a link owned by
 * another clone leaves the filesystem untouched. Attribution is judged by
 * `pointsInto`, the same predicate `entryLinks` uses, so "which links belong
 * to an entry" has one answer everywhere.
 */
export declare function unlinkIfPointsInto(linkPath: string, dir: string): Promise<boolean>;
/**
 * Resolve a skill symlink to its target path. Returns `undefined` if the
 * symlink does not exist or is not a symlink.
 */
export declare function readLinkTarget(skillName: string): Promise<string | undefined>;
/** Check whether the official skills root has a non-symlink directory/file
 *  that would collide with a new skill name. Returns true if a collision
 *  exists (i.e. a real directory or file, not a nexus-managed symlink). */
export declare function hasCollision(skillName: string): Promise<boolean>;
//# sourceMappingURL=link.d.ts.map
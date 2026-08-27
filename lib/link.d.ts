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
/**
 * True when the entry is enabled — i.e. at least one symlink in the official
 * skills root points inside its clone.
 *
 * State is looked up by link *target*, not by name: multi-skill repos create
 * one symlink per discovered skill (named after each skill's frontmatter),
 * so no symlink ever carries the entry name. A name-based `isLinked(entry.name)`
 * reported such entries as disabled even while all of their skills were
 * linked — breaking `list`, the `disable` early-return, and the default
 * `update` target filter. Scanning targets works for single- and multi-skill
 * repos alike and does not require the clone to be present.
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
 * Resolve a skill symlink to its target path. Returns `undefined` if the
 * symlink does not exist or is not a symlink.
 */
export declare function readLinkTarget(skillName: string): Promise<string | undefined>;
/** Check whether the official skills root has a non-symlink directory/file
 *  that would collide with a new skill name. Returns true if a collision
 *  exists (i.e. a real directory or file, not a nexus-managed symlink). */
export declare function hasCollision(skillName: string): Promise<boolean>;
//# sourceMappingURL=link.d.ts.map
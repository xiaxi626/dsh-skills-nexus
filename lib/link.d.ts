import type { SkillEntry } from './types.js';
/**
 * Manage links that expose cloned skills to the official DSH skills root.
 *
 * The official filesystem provider only scans one level deep under
 * `~/.dsh/skills/`, so nexus creates one link per discovered skill at the top
 * level. This way:
 *   - The official provider handles discovery, watching, and error tolerance.
 *   - Nexus still manages git clones, subdir installs, and collection repos.
 *   - enable/disable is just create/remove link — lightweight and atomic.
 *
 * On Windows `linkSkill` creates an **NTFS junction**, because a real directory
 * symlink needs a privilege junctions do not. That single choice is why every
 * reader below goes through `resolveLinkTarget` (`realpath`) and every removal
 * through `removeLinkEntry` (`rmdir`): Node reports a junction as an ordinary
 * directory to `lstat`, refuses `readlink` on it with `EINVAL`, and refuses
 * `unlink` on it with `EPERM`. The former `lstat` + `readlink` + `unlink`
 * triple therefore made every junction invisible and undeletable, which showed
 * up as "an entry with three links reports itself disabled, and `disable`
 * silently removes nothing".
 */
/** True if a link (or directory) exists at the official skill path. */
export declare function isLinked(skillName: string): Promise<boolean>;
/** One link that belongs to an entry: its name and resolved target path. */
export interface EntryLink {
    /** Link name under the official skills root. */
    name: string;
    /** Absolute resolved target — inside the entry's clone (or one of its subdirs). */
    target: string;
}
/**
 * Section 6.4 attribution predicate: `resolved` equals `base` or lies inside
 * it. Single source for link ownership — shared by `entryLinks` (list/state
 * derivation) and `unlinkIfPointsInto` (the attribution unlink), so both sides
 * judge ownership identically.
 */
/**
 * Canonical-path resolver: tries `realpath` first; when the path does not
 * exist (e.g. a repo deleted before its links), walks up the directory tree
 * to resolve the deepest existing ancestor via `realpath`, then appends the
 * remaining (non-existing) tail.  This keeps both sides of a `pointsInto`
 * comparison in the same canonical format even when one side has been
 * removed.
 *
 * The reason this exists: `resolveLinkTarget` may return paths with **all**
 * parent symlinks resolved (e.g. macOS `/var` → `/private/var`, or Windows
 * 8.3 short names expanded).  The base directory against which targets are
 * compared must go through the same resolution, or `pointsInto` will see
 * different formats and conclude they are unrelated.
 */
export declare function safeRealPath(p: string): Promise<string>;
/**
 * The directory a link points at — **including when that directory no longer
 * exists**.
 *
 * `resolveLinkTarget` (`realpath`) is the right answer whenever the target is
 * live, and the only reader that works for a Windows junction. For a *dangling*
 * POSIX symlink it is `undefined`, while `readlink` still knows the path — and
 * that is exactly the case link cleanup runs into: `remove` and `update` delete
 * a clone first and its links second, so by the time the links are visited their
 * target is already gone. Reading nothing there leaves them behind, which is
 * the "dangling link no later command can attribute" residue `update` exists to
 * prevent.
 *
 * Returns `undefined` when nothing can be recovered: absent, or a Windows
 * junction whose target was deleted (`realpath` and `readlink` both refuse such
 * a reparse point — see the module header).
 */
export declare function readLinkEntryTarget(path: string): Promise<string | undefined>;
/** True when `path` is a link rather than a real directory or file. */
export declare function isLinkAt(path: string): Promise<boolean>;
/**
 * All links in the official skills root whose target resolves inside the
 * entry's clone (or one of its subdirs) — the entry-to-link one-to-many
 * relation (section 6.4).
 *
 * State is looked up by link *target*, not by name: multi-skill repos create
 * one link per discovered skill (named after each skill's frontmatter), so no
 * link ever carries the entry name. A name-based `isLinked(entry.name)`
 * reported such entries as disabled even while all of their skills were
 * linked — breaking `list`, the `disable` early-return, and the default
 * `update` target filter. Scanning targets works for single- and multi-skill
 * repos alike and does not require the clone to be present.
 */
export declare function entryLinks(entry: SkillEntry): Promise<EntryLink[]>;
/**
 * True when the entry is enabled — at least one link points into its clone.
 * Thin wrapper over `entryLinks`, the single target-ownership scanner.
 */
export declare function isEntryEnabled(entry: SkillEntry): Promise<boolean>;
/**
 * Create a link in the official skills root pointing to `targetDir`.
 *
 * On Windows this is an NTFS junction (`symlink(..., 'junction')`), which needs
 * no elevation — and which `resolveLinkTarget`, unlike `lstat`/`readlink`,
 * reports correctly. Every reader of a link in this module goes through it for
 * that reason.
 *
 * An existing entry at the same name is replaced: any link (ours or stale,
 * including a dangling one), and a plain file. A populated real directory is
 * left in place — `symlink` then fails with `EEXIST`, which is the honest
 * outcome, rather than deleting content the user put there.
 */
export declare function linkSkill(skillName: string, targetDir: string): Promise<void>;
/**
 * Remove a skill's link from the official skills root.
 *
 * A real directory the user placed there is left alone — see `isLinkEntry` for
 * the three proofs that decide it, and note that they must stay in sync: this
 * function's whole safety argument is "a real directory is never a link".
 */
export declare function unlinkSkill(skillName: string): Promise<void>;
/**
 * Remove the link at `linkPath` when its resolved target lies inside `dir` (or
 * equals it) — the section 6.4 target-attribution unlink. Returns true iff a
 * link was removed; a missing path, a non-link, or a link owned by another
 * clone leaves the filesystem untouched. Attribution is judged by
 * `pointsInto`, the same predicate `entryLinks` uses, so "which links belong
 * to an entry" has one answer everywhere.
 *
 * The predicate is also the guard: a path that resolves into a clone is a link
 * nexus created, because a real directory a user placed in the skills root
 * resolves to itself and therefore lies outside `dir`.
 */
export declare function unlinkIfPointsInto(linkPath: string, dir: string): Promise<boolean>;
/**
 * Resolve a skill link to the directory it exposes. Returns `undefined` if the
 * path does not exist or cannot be resolved (a dangling or cyclic link) — see
 * `resolveLinkTarget` for why this reads through `realpath` rather than
 * `readlink`.
 */
export declare function readLinkTarget(skillName: string): Promise<string | undefined>;
/** Check whether the official skills root has a non-link directory/file that
 *  would collide with a new skill name. Returns true if a collision exists
 *  (i.e. a real directory or file, not a nexus-managed link). */
export declare function hasCollision(skillName: string): Promise<boolean>;
//# sourceMappingURL=link.d.ts.map
/**
 * Filesystem layout:
 *
 *   <DSH_HOME>/                           # ~/.dsh  (or $DSH_HOME)
 *   ├── skills/                           # official DSH skills root (symlinks point here)
 *   │   ├── skill-a/        → symlink →  ~/.dsh/skills-nexus/repos/repo-a/
 *   │   └── skill-b/        → symlink →  ~/.dsh/skills-nexus/repos/repo-b/subdir/
 *   │
 *   └── skills-nexus/
 *       ├── manifest.json                 # state backend
 *       ├── .locks/                       # cross-process write-op locks (<name>.lock)
 *       └── repos/
 *           ├── repo-a/                   # git clone (full; sparse when --subdir was used)
 *           │   ├── SKILL.md
 *           │   └── references/…
 *           └── repo-b/
 *               └── skills/
 *                   └── subdir/
 *                       └── SKILL.md
 */
export declare const DSH_HOME: string;
export declare const NEXUS_HOME: string;
/** Official DSH user skills root — symlinks are created here so the
 *  filesystem provider discovers them automatically. */
export declare const OFFICIAL_SKILLS_DIR: string;
/** Where nexus stores git clones: full, or sparse for `--subdir` entries. */
export declare const REPOS_DIR: string;
export declare const MANIFEST_PATH: string;
/** Cross-process write-op lock files (§7.3 layer 3): one `<name>.lock` per entry. */
export declare const LOCKS_DIR: string;
/** Absolute path to a registered repo's cloned directory. */
export declare function repoDir(path: string): string;
/** Absolute path of a skill's symlink in the official root. */
export declare function skillLinkPath(name: string): string;
/**
 * The directory a link path actually resolves to — the one way nexus reads a
 * link's target.
 *
 * Uses `fs.realpath` (not `lstat` + `readlink`) because Windows NTFS
 * junctions are invisible to `readlink` (`EINVAL`) and `lstat` reports them
 * as plain directories.  `realpath` resolves junctions correctly on every
 * platform, returning the canonical (long) path.
 *
 * Returns `undefined` when the link is absent, dangling or cyclic — the caller
 * treats that as "not one of ours", which is the pre-existing behaviour for a
 * target that cannot be resolved.
 */
export declare function resolveLinkTarget(linkPath: string): Promise<string | undefined>;
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export declare const SKILLS_DIR: string;
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export declare function skillDir(path: string): string;
//# sourceMappingURL=paths.d.ts.map
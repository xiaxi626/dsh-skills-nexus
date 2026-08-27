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
 *       └── repos/
 *           ├── repo-a/                   # full git clone
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
/** Where nexus stores full git clones. */
export declare const REPOS_DIR: string;
export declare const MANIFEST_PATH: string;
/** Absolute path to a registered repo's cloned directory. */
export declare function repoDir(path: string): string;
/** Absolute path of a skill's symlink in the official root. */
export declare function skillLinkPath(name: string): string;
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export declare const SKILLS_DIR: string;
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export declare function skillDir(path: string): string;
//# sourceMappingURL=paths.d.ts.map
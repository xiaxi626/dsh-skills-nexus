/**
 * Filesystem layout:
 *
 *   <DSH_HOME>/                           # ~/.dsh  (or $DSH_HOME)
 *   └── skills-nexus/
 *       ├── manifest.json                 # state backend (CLI writes, provider reads)
 *       └── skills/
 *           ├── repo-a/                   # git clone of each registered repo
 *           │   ├── SKILL.md
 *           │   └── references/...
 *           └── repo-b/
 */
export declare const DSH_HOME: string;
export declare const NEXUS_HOME: string;
export declare const SKILLS_DIR: string;
export declare const MANIFEST_PATH: string;
/** Absolute path to a registered skill's cloned directory. */
export declare function skillDir(path: string): string;
//# sourceMappingURL=paths.d.ts.map
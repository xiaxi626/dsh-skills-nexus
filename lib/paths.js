import { homedir } from 'node:os';
import { join } from 'node:path';
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
export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
export const NEXUS_HOME = process.env.DSH_SKILLS_NEXUS_HOME ?? join(DSH_HOME, 'skills-nexus');
/** Official DSH user skills root — symlinks are created here so the
 *  filesystem provider discovers them automatically. */
export const OFFICIAL_SKILLS_DIR = join(DSH_HOME, 'skills');
/** Where nexus stores git clones: full, or sparse for `--subdir` entries. */
export const REPOS_DIR = join(NEXUS_HOME, 'repos');
export const MANIFEST_PATH = join(NEXUS_HOME, 'manifest.json');
/** Cross-process write-op lock files (§7.3 layer 3): one `<name>.lock` per entry. */
export const LOCKS_DIR = join(NEXUS_HOME, '.locks');
/** Absolute path to a registered repo's cloned directory. */
export function repoDir(path) {
    return join(REPOS_DIR, path);
}
/** Absolute path of a skill's symlink in the official root. */
export function skillLinkPath(name) {
    return join(OFFICIAL_SKILLS_DIR, name);
}
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export const SKILLS_DIR = REPOS_DIR;
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export function skillDir(path) {
    return repoDir(path);
}
//# sourceMappingURL=paths.js.map
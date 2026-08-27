import { homedir } from 'node:os'
import { join } from 'node:path'

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

export const DSH_HOME: string = process.env.DSH_HOME ?? join(homedir(), '.dsh')

export const NEXUS_HOME: string =
  process.env.DSH_SKILLS_NEXUS_HOME ?? join(DSH_HOME, 'skills-nexus')

/** Official DSH user skills root — symlinks are created here so the
 *  filesystem provider discovers them automatically. */
export const OFFICIAL_SKILLS_DIR: string = join(DSH_HOME, 'skills')

/** Where nexus stores full git clones. */
export const REPOS_DIR: string = join(NEXUS_HOME, 'repos')

export const MANIFEST_PATH: string = join(NEXUS_HOME, 'manifest.json')

/** Absolute path to a registered repo's cloned directory. */
export function repoDir(path: string): string {
  return join(REPOS_DIR, path)
}

/** Absolute path of a skill's symlink in the official root. */
export function skillLinkPath(name: string): string {
  return join(OFFICIAL_SKILLS_DIR, name)
}

/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export const SKILLS_DIR = REPOS_DIR

/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export function skillDir(path: string): string {
  return repoDir(path)
}

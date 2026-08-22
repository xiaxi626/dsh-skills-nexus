import { homedir } from 'node:os';
import { join } from 'node:path';
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
export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
export const NEXUS_HOME = process.env.DSH_SKILLS_NEXUS_HOME ?? join(DSH_HOME, 'skills-nexus');
export const SKILLS_DIR = join(NEXUS_HOME, 'skills');
export const MANIFEST_PATH = join(NEXUS_HOME, 'manifest.json');
/** Absolute path to a registered skill's cloned directory. */
export function skillDir(path) {
    return join(SKILLS_DIR, path);
}
//# sourceMappingURL=paths.js.map
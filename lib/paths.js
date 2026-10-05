import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
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
/**
 * The directory a link path actually resolves to — the one way nexus reads a
 * link's target.
 *
 * `fs.realpath`, **not** `lstat` + `readlink`, because of how Windows reports
 * an NTFS junction (which is what `linkSkill` creates there, since a real
 * directory symlink needs a privilege junctions do not):
 *
 *   - `lstat(link).isSymbolicLink()` is **false** for a junction — it reports
 *     `S_IFDIR`, indistinguishable from a plain directory;
 *   - `readlink(link)` fails with `EINVAL`;
 *   - `realpath(link)` resolves it correctly on every platform.
 *
 * The `lstat` + `readlink` pair therefore made every junction invisible to
 * attribution: `entryLinks` returned `[]` for a fully linked entry, so `list`
 * showed it disabled, `disable` no-opped, bare `update` skipped it, and
 * `unlinkIfPointsInto` removed nothing. Reading through `realpath` gives one
 * code path that agrees with itself on Linux, macOS and Windows.
 *
 * Returns `undefined` when the link is absent, dangling or cyclic — the caller
 * treats that as "not one of ours", which is the pre-existing behaviour for a
 * target that cannot be resolved.
 */
export async function resolveLinkTarget(linkPath) {
    try {
        return await realpath(linkPath);
    }
    catch {
        return undefined;
    }
}
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export const SKILLS_DIR = REPOS_DIR;
/** @deprecated Use `repoDir` instead — kept for backward compatibility. */
export function skillDir(path) {
    return repoDir(path);
}
//# sourceMappingURL=paths.js.map
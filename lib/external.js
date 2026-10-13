/**
 * Channel E — external entry core for the trae-cn link channel.
 *
 * Provides the ability to discover skills from external sources (currently
 * trae-cn's local skill directories) and register them as manifest entries
 * that merely symlink to directories the user already owns. Nexus never
 * clones, fetches, updates or deletes those directories — it only manages
 * the manifest records and the symlinks in `~/.dsh/skills/`.
 *
 * The key abstraction is `entrySkillDir`: every read path that used to
 * compute `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`
 * now calls this single function, which redirects external entries to their
 * `externalDir` instead. Without it, external entries would be invisible to
 * toggle, health, list and link scanning.
 */
import { homedir } from 'node:os';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { repoDir } from './paths.js';
import { addEntry, readManifest } from './manifest.js';
import { hasCollision, linkSkill } from './link.js';
/* ------------------------------------------------------------------ */
/* entrySkillDir — the single read-path resolver                     */
/* ------------------------------------------------------------------ */
/**
 * Return the absolute path to the skill root directory for any entry.
 *
 * - **external** entries → `entry.externalDir` (the user-owned directory).
 * - **managed** entries → the existing ternary:
 *   `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`.
 *
 * Implementation discipline: the managed branch must remain byte-for-byte
 * equivalent to the ternary formerly inlined in toggle.ts, routes.ts and
 * remove.ts, so no managed entry regresses.
 */
export function entrySkillDir(entry) {
    // New-style external entries (from the trae-cn link channel) carry
    // `externalDir`. Old-style external entries (from `--link-only` adoption)
    // use `path` like managed entries but with `ownership: 'external'`.
    if (entry.ownership === 'external' && entry.externalDir)
        return entry.externalDir;
    const dir = repoDir(entry.path);
    return entry.subdir ? join(dir, entry.subdir) : dir;
}
/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
/** Fixed subdirectories scanned under the trae-cn root. */
export const TRAE_CN_SUBDIRS = ['skills', 'builtin_skills'];
/** A link-channel operation was refused or failed. */
export class LinkError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'LinkError';
        this.code = code;
    }
}
/* ------------------------------------------------------------------ */
/* resolveTraeCnRoot                                                   */
/* ------------------------------------------------------------------ */
/**
 * Locate the trae-cn skills root.
 *
 * Priority: `opts.traeCnDir` > `TRAE_CN_DIR` env > `~/.trae-cn`.
 * Throws `LinkError('not-found')` when the resolved directory does not exist.
 */
export function resolveTraeCnRoot(opts) {
    const root = resolve(opts?.traeCnDir ?? process.env.TRAE_CN_DIR ?? join(homedir(), '.trae-cn'));
    // Synchronous existence check via stat would require await; callers handle
    // the async version. This function is intentionally sync so it can be used
    // in argument-validation positions; the async `assertTraeCnRoot` below
    // performs the actual filesystem check.
    return root;
}
/** Async variant that verifies the directory exists. */
export async function assertTraeCnRoot(opts) {
    const root = resolveTraeCnRoot(opts);
    try {
        const st = await stat(root);
        if (!st.isDirectory())
            throw new Error('not a directory');
    }
    catch {
        throw new LinkError('not-found', `trae-cn root not found at ${root}. ` +
            `Pass --trae-cn-dir <dir> or set TRAE_CN_DIR to override.`);
    }
    return root;
}
/* ------------------------------------------------------------------ */
/* discoverTraeCnSkills                                                */
/* ------------------------------------------------------------------ */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
/**
 * Read the frontmatter `name` from a SKILL.md file. Returns '' when the file
 * is absent, has no frontmatter, or the name field is missing/empty.
 */
async function readSkillName(skillFile) {
    let raw;
    try {
        raw = await readFile(skillFile, 'utf8');
    }
    catch {
        return '';
    }
    const match = raw.match(FRONTMATTER_RE);
    if (!match)
        return '';
    try {
        const fm = parseYaml(match[1] ?? '');
        if (fm && typeof fm === 'object' && typeof fm.name === 'string') {
            return fm.name.trim();
        }
    }
    catch {
        // Malformed YAML — degrade to empty.
    }
    return '';
}
/**
 * Discover every skill under the trae-cn root's fixed subdirectories.
 *
 * For each subdir in `TRAE_CN_SUBDIRS`, scans one level deep for directories
 * containing a `SKILL.md` file. Returns a flat list of `DiscoveredSkill`
 * records with the frontmatter name (used for display and conflict
 * diagnostics).
 */
export async function discoverTraeCnSkills(root) {
    const out = [];
    for (const subdir of TRAE_CN_SUBDIRS) {
        const subdirPath = join(root, subdir);
        let entries;
        try {
            entries = await readdir(subdirPath, { withFileTypes: true });
        }
        catch {
            // Subdir absent — skip silently (trae-cn may not have builtin_skills).
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.'))
                continue;
            const dir = join(subdirPath, entry.name);
            const skillFile = join(dir, 'SKILL.md');
            const skillName = await readSkillName(skillFile);
            // Only directories with a SKILL.md count as skills.
            try {
                await stat(skillFile);
            }
            catch {
                continue;
            }
            out.push({ subdir, name: entry.name, dir, skillName });
        }
    }
    return out;
}
/* ------------------------------------------------------------------ */
/* planLinkLocal                                                       */
/* ------------------------------------------------------------------ */
/**
 * Build a link plan without creating anything.
 *
 * `source` identifies the external source — currently only `'trae-cn'` is
 * accepted; any other value throws a `LinkError` (reserved for future
 * extension to qoder and other sources).
 *
 * The plan contains one entry per discovered skill, with:
 *   - `groupPath` = `[group ?? source, subdir, dirName]`
 *   - `name` = `groupPath.join('.')`
 *   - `externalDir` = absolute path to the skill directory
 *
 * Names that already exist in the manifest are reported as conflicts.
 */
export async function planLinkLocal(source, opts = {}) {
    if (source !== 'trae-cn') {
        throw new LinkError('resolve-failed', `unknown link source "${source}" — currently only "trae-cn" is supported.`);
    }
    const root = await assertTraeCnRoot(opts);
    const discovered = await discoverTraeCnSkills(root);
    const manifest = await readManifest();
    const group = opts.group ?? source;
    const entries = [];
    const conflicts = [];
    for (const d of discovered) {
        const groupPath = [group, d.subdir, d.name];
        const name = groupPath.join('.');
        if (manifest.skills.some((s) => s.name === name) && !opts.force) {
            conflicts.push(name);
            continue;
        }
        entries.push({ name, groupPath, externalDir: d.dir, skillName: d.skillName });
    }
    return { source, entries, conflicts };
}
/* ------------------------------------------------------------------ */
/* linkLocal                                                           */
/* ------------------------------------------------------------------ */
/**
 * Execute the link plan: write manifest entries and create symlinks.
 *
 * For each planned entry:
 *   1. Construct a `SkillEntry` with `ownership: 'external'`, `externalDir`,
 *      and `groupPath`.
 *   2. Add it to the manifest via `addEntry`.
 *   3. Create a symlink in `~/.dsh/skills/<flat-name>` → `externalDir`.
 *
 * Returns the plan plus the result (which entries were added / skipped).
 */
export async function linkLocal(source, opts = {}, io = {
    confirm: async () => false,
    progress: () => { },
    emit: () => { },
    error: () => { },
    interactive: false,
}) {
    const plan = await planLinkLocal(source, opts);
    const added = [];
    const skipped = [...plan.conflicts];
    for (const entry of plan.entries) {
        // Check for filesystem-level collisions (a real directory at the link path).
        if (await hasCollision(entry.name)) {
            io.error(`  ⚠ collision: "${entry.name}" — a real directory exists at the link path\n`);
            skipped.push(entry.name);
            continue;
        }
        const skillEntry = {
            name: entry.name,
            url: `${source}:${entry.groupPath.slice(1).join('/')}`,
            gitUrl: '',
            ref: '',
            ownership: 'external',
            path: entry.externalDir,
            addedAt: new Date().toISOString(),
            externalDir: entry.externalDir,
            groupPath: entry.groupPath,
        };
        await addEntry(skillEntry);
        await linkSkill(entry.name, entry.externalDir);
        added.push(entry.name);
    }
    return { plan, result: { added, skipped } };
}
//# sourceMappingURL=external.js.map
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MANIFEST_PATH, repoDir } from './paths.js';
import { entryLinks } from './link.js';
import { getUpdateStatus } from './update-cache.js';
import { withManifestLock } from './locks.js';
const EMPTY = { version: 1, skills: [] };
/** Read the manifest, returning an empty one if it does not exist yet. */
export async function readManifest() {
    let raw;
    try {
        raw = await readFile(MANIFEST_PATH, 'utf8');
    }
    catch {
        return { ...EMPTY, skills: [] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.skills)) {
            return parsed;
        }
    }
    catch {
        // Corrupt manifest — back it up rather than silently overwrite.
        await writeFile(`${MANIFEST_PATH}.corrupt-${Date.now()}`, raw, 'utf8');
    }
    return { ...EMPTY, skills: [] };
}
/**
 * Persist the manifest atomically: write a temp file in the same directory,
 * then rename it over the live manifest. The live file is never truncated in
 * place, so an interrupted write leaves either the old or the new *complete*
 * manifest — never an empty/half-written one. The fixed temp name is reused
 * (truncated) on the next write, so a crash between the write and the rename
 * leaves at most one harmless orphan that self-heals; it sits beside
 * manifest.json inside NEXUS_HOME and never touches repos/ or the project tree.
 */
export async function writeManifest(manifest) {
    await mkdir(dirname(MANIFEST_PATH), { recursive: true });
    const json = JSON.stringify(manifest, null, 2) + '\n';
    const tmp = `${MANIFEST_PATH}.tmp`;
    try {
        await writeFile(tmp, json, 'utf8');
        await rename(tmp, MANIFEST_PATH); // Windows: libuv uses MOVEFILE_REPLACE_EXISTING; POSIX rename is atomic
    }
    catch (err) {
        await rm(tmp, { recursive: true, force: true }); // recursive so a stray dir at the tmp path can't mask the real error
        throw err;
    }
}
/** Find a skill entry by its management name. */
export function findEntry(manifest, name) {
    return manifest.skills.find((s) => s.name === name);
}
/** True if a name (or path) is already taken in the manifest. */
export function hasEntry(manifest, name) {
    return manifest.skills.some((s) => s.name === name || s.path === name);
}
/**
 * True when the entry has a git source — a remote URL was recorded at install
 * time. Entries without one (archive imports, hand-written snapshots) can be
 * listed, toggled and removed, but there is no history to fetch, update or
 * switch: every git-bound path refuses them explicitly instead of running git
 * in a directory that has no repository.
 */
export function hasGitSource(entry) {
    return entry.gitUrl.length > 0;
}
/**
 * True when the entry merely links a directory the user owns (a `--link-only`
 * adoption). Such an entry is never deleted by `remove` and never copied into
 * an export package: nexus must not touch a directory it does not own.
 */
export function isExternalEntry(entry) {
    return entry.ownership === 'external';
}
/**
 * Append a new entry and persist. Throws on duplicate name/path.
 *
 * The entire read → check → write cycle runs inside `withManifestLock` so
 * that two concurrent `add` calls (e.g. CLI + HTTP panel) cannot both read
 * the same pre-add manifest and then overwrite each other's write, silently
 * dropping one entry.
 */
export async function addEntry(entry) {
    return withManifestLock(async () => {
        const manifest = await readManifest();
        if (hasEntry(manifest, entry.name)) {
            throw new Error(`a skill named "${entry.name}" is already registered`);
        }
        if (manifest.skills.some((s) => s.path === entry.path)) {
            throw new Error(`directory "${entry.path}" is already used by another skill`);
        }
        manifest.skills.push(entry);
        await writeManifest(manifest);
    });
}
/**
 * Remove an entry by name and persist. Returns the removed entry, if any.
 *
 * Wrapped in `withManifestLock` for the same reason as `addEntry`: the
 * read → splice → write cycle must be atomic across processes.
 */
export async function removeEntry(name) {
    return withManifestLock(async () => {
        const manifest = await readManifest();
        const idx = manifest.skills.findIndex((s) => s.name === name);
        if (idx === -1)
            return undefined;
        const [removed] = manifest.skills.splice(idx, 1);
        await writeManifest(manifest);
        return removed;
    });
}
/**
 * Stamp `updatedAt` after a successful update — plus the resolved commit
 * ("lockfile-lite": the manifest always knows the exact installed version)
 * and, for `switch-version`, the newly checked-out ref (§8.2 step 7).
 *
 * Wrapped in `withManifestLock`: the read → find → mutate → write cycle
 * would otherwise race against a concurrent `addEntry` or `removeEntry`
 * from another process, losing whichever writer goes second.
 */
export async function markUpdated(name, commit, ref, locked) {
    return withManifestLock(async () => {
        const manifest = await readManifest();
        const entry = findEntry(manifest, name);
        if (!entry)
            return;
        entry.updatedAt = new Date().toISOString();
        if (commit)
            entry.commit = commit;
        if (ref)
            entry.ref = ref;
        if (locked !== undefined)
            entry.locked = locked;
        await writeManifest(manifest);
    });
}
/** Best-effort recursive delete of a skill's cloned directory. */
export async function removeSkillDir(path) {
    await rm(repoDir(path), { recursive: true, force: true });
}
/**
 * Read the manifest and merge each entry's derived state (§6.3) — the thin
 * core behind `GET /skills-nexus/list`. Read-only: nothing is persisted, and
 * a missing/corrupt manifest degrades to an empty list like `readManifest`.
 */
export async function listEntries() {
    const manifest = await readManifest();
    const out = [];
    for (const entry of manifest.skills) {
        const links = await entryLinks(entry);
        out.push({
            entry,
            enabled: links.length > 0,
            links,
            update: getUpdateStatus(entry.name) ?? null,
        });
    }
    return out;
}
//# sourceMappingURL=manifest.js.map
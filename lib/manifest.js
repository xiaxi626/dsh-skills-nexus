import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MANIFEST_PATH } from './paths.js';
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
/** Persist the manifest atomically (temp file + rename semantics via direct write). */
export async function writeManifest(manifest) {
    await mkdir(dirname(MANIFEST_PATH), { recursive: true });
    const json = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(MANIFEST_PATH, json, 'utf8');
}
/** Find a skill entry by its management name. */
export function findEntry(manifest, name) {
    return manifest.skills.find((s) => s.name === name);
}
/** True if a name (or path) is already taken in the manifest. */
export function hasEntry(manifest, name) {
    return manifest.skills.some((s) => s.name === name || s.path === name);
}
/** Append a new entry and persist. Throws on duplicate name/path. */
export async function addEntry(entry) {
    const manifest = await readManifest();
    if (hasEntry(manifest, entry.name)) {
        throw new Error(`a skill named "${entry.name}" is already registered`);
    }
    if (manifest.skills.some((s) => s.path === entry.path)) {
        throw new Error(`directory "${entry.path}" is already used by another skill`);
    }
    manifest.skills.push(entry);
    await writeManifest(manifest);
}
/** Remove an entry by name and persist. Returns the removed entry, if any. */
export async function removeEntry(name) {
    const manifest = await readManifest();
    const idx = manifest.skills.findIndex((s) => s.name === name);
    if (idx === -1)
        return undefined;
    const [removed] = manifest.skills.splice(idx, 1);
    await writeManifest(manifest);
    return removed;
}
/** Toggle the `enabled` flag of an entry. Returns the updated entry, if found. */
export async function setEnabled(name, enabled) {
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (!entry)
        return undefined;
    entry.enabled = enabled;
    await writeManifest(manifest);
    return entry;
}
/** Stamp `updatedAt` on an entry after a successful git pull. */
export async function markUpdated(name) {
    const manifest = await readManifest();
    const entry = findEntry(manifest, name);
    if (!entry)
        return;
    entry.updatedAt = new Date().toISOString();
    await writeManifest(manifest);
}
/** Best-effort recursive delete of a skill's cloned directory. */
export async function removeSkillDir(path) {
    const { skillDir } = await import('./paths.js');
    await rm(skillDir(path), { recursive: true, force: true });
}
//# sourceMappingURL=manifest.js.map
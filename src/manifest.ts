import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MANIFEST_PATH, repoDir } from './paths.js'
import { entryLinks } from './link.js'
import { getUpdateStatus } from './update-cache.js'
import type { EntryLink } from './link.js'
import type { UpdateStatus } from './update-cache.js'
import type { Manifest, SkillEntry } from './types.js'

const EMPTY: Manifest = { version: 1, skills: [] }

/** Read the manifest, returning an empty one if it does not exist yet. */
export async function readManifest(): Promise<Manifest> {
  let raw: string
  try {
    raw = await readFile(MANIFEST_PATH, 'utf8')
  } catch {
    return { ...EMPTY, skills: [] }
  }
  try {
    const parsed = JSON.parse(raw) as Manifest
    if (parsed && Array.isArray(parsed.skills)) {
      return parsed
    }
  } catch {
    // Corrupt manifest — back it up rather than silently overwrite.
    await writeFile(`${MANIFEST_PATH}.corrupt-${Date.now()}`, raw, 'utf8')
  }
  return { ...EMPTY, skills: [] }
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
export async function writeManifest(manifest: Manifest): Promise<void> {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true })
  const json = JSON.stringify(manifest, null, 2) + '\n'
  const tmp = `${MANIFEST_PATH}.tmp`
  try {
    await writeFile(tmp, json, 'utf8')
    await rename(tmp, MANIFEST_PATH) // Windows: libuv uses MOVEFILE_REPLACE_EXISTING; POSIX rename is atomic
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }) // recursive so a stray dir at the tmp path can't mask the real error
    throw err
  }
}

/** Find a skill entry by its management name. */
export function findEntry(manifest: Manifest, name: string): SkillEntry | undefined {
  return manifest.skills.find((s) => s.name === name)
}

/** True if a name (or path) is already taken in the manifest. */
export function hasEntry(manifest: Manifest, name: string): boolean {
  return manifest.skills.some(
    (s) => s.name === name || s.path === name,
  )
}

/**
 * True when the entry has a git source — a remote URL was recorded at install
 * time. Entries without one (archive imports, hand-written snapshots) can be
 * listed, toggled and removed, but there is no history to fetch, update or
 * switch: every git-bound path refuses them explicitly instead of running git
 * in a directory that has no repository.
 */
export function hasGitSource(entry: SkillEntry): boolean {
  return entry.gitUrl.length > 0
}

/**
 * True when the entry merely links a directory the user owns (a `--link-only`
 * adoption). Such an entry is never deleted by `remove` and never copied into
 * an export package: nexus must not touch a directory it does not own.
 */
export function isExternalEntry(entry: SkillEntry): boolean {
  return entry.ownership === 'external'
}

/** Append a new entry and persist. Throws on duplicate name/path. */
export async function addEntry(entry: SkillEntry): Promise<void> {
  const manifest = await readManifest()
  if (hasEntry(manifest, entry.name)) {
    throw new Error(`a skill named "${entry.name}" is already registered`)
  }
  if (manifest.skills.some((s) => s.path === entry.path)) {
    throw new Error(`directory "${entry.path}" is already used by another skill`)
  }
  manifest.skills.push(entry)
  await writeManifest(manifest)
}

/** Remove an entry by name and persist. Returns the removed entry, if any. */
export async function removeEntry(name: string): Promise<SkillEntry | undefined> {
  const manifest = await readManifest()
  const idx = manifest.skills.findIndex((s) => s.name === name)
  if (idx === -1) return undefined
  const [removed] = manifest.skills.splice(idx, 1)
  await writeManifest(manifest)
  return removed
}

/**
 * Stamp `updatedAt` after a successful update — plus the resolved commit
 * ("lockfile-lite": the manifest always knows the exact installed version)
 * and, for `switch-version`, the newly checked-out ref (§8.2 step 7).
 */
export async function markUpdated(name: string, commit?: string, ref?: string, locked?: boolean): Promise<void> {
  const manifest = await readManifest()
  const entry = findEntry(manifest, name)
  if (!entry) return
  entry.updatedAt = new Date().toISOString()
  if (commit) entry.commit = commit
  if (ref) entry.ref = ref
  if (locked !== undefined) entry.locked = locked
  await writeManifest(manifest)
}

/** Best-effort recursive delete of a skill's cloned directory. */
export async function removeSkillDir(path: string): Promise<void> {
  await rm(repoDir(path), { recursive: true, force: true })
}

/* ------------------------------------------------------------------ */
/* Listed view (manifest + derived runtime state)                      */
/* ------------------------------------------------------------------ */

/**
 * One manifest entry as the `list` route needs it (§7.2): the stored entry
 * plus its derived runtime state —
 *   - `enabled` / `links` — reverse-inferred from the symlinks in the
 *     official skills root, never persisted (§5.1/§6.4);
 *   - `update` — the last network comparison from the runtime cache (§5.2),
 *     `null` when the entry was never checked (pinned and source-less entries
 *     are never written to the cache, so they stay `null` too).
 */
export interface ListedEntry {
  entry: SkillEntry
  /** True when at least one symlink points into the entry's clone (§6.4). */
  enabled: boolean
  /** Every symlink currently pointing into this entry, in FS name order. */
  links: EntryLink[]
  /** Last check-updates result (runtime cache), or null when never checked. */
  update: UpdateStatus | null
}

/**
 * Read the manifest and merge each entry's derived state (§6.3) — the thin
 * core behind `GET /skills-nexus/list`. Read-only: nothing is persisted, and
 * a missing/corrupt manifest degrades to an empty list like `readManifest`.
 */
export async function listEntries(): Promise<ListedEntry[]> {
  const manifest = await readManifest()
  const out: ListedEntry[] = []
  for (const entry of manifest.skills) {
    const links = await entryLinks(entry)
    out.push({
      entry,
      enabled: links.length > 0,
      links,
      update: getUpdateStatus(entry.name) ?? null,
    })
  }
  return out
}

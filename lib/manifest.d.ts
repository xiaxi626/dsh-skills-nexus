import type { Manifest, SkillEntry } from './types.js';
/** Read the manifest, returning an empty one if it does not exist yet. */
export declare function readManifest(): Promise<Manifest>;
/**
 * Persist the manifest atomically: write a temp file in the same directory,
 * then rename it over the live manifest. The live file is never truncated in
 * place, so an interrupted write leaves either the old or the new *complete*
 * manifest — never an empty/half-written one. The fixed temp name is reused
 * (truncated) on the next write, so a crash between the write and the rename
 * leaves at most one harmless orphan that self-heals; it sits beside
 * manifest.json inside NEXUS_HOME and never touches repos/ or the project tree.
 */
export declare function writeManifest(manifest: Manifest): Promise<void>;
/** Find a skill entry by its management name. */
export declare function findEntry(manifest: Manifest, name: string): SkillEntry | undefined;
/** True if a name (or path) is already taken in the manifest. */
export declare function hasEntry(manifest: Manifest, name: string): boolean;
/** Append a new entry and persist. Throws on duplicate name/path. */
export declare function addEntry(entry: SkillEntry): Promise<void>;
/** Remove an entry by name and persist. Returns the removed entry, if any. */
export declare function removeEntry(name: string): Promise<SkillEntry | undefined>;
/**
 * Stamp `updatedAt` (and the resolved commit, if given) after a successful
 * update. The commit is the "lockfile-lite" half of version management: the
 * manifest always knows the exact installed version.
 */
export declare function markUpdated(name: string, commit?: string): Promise<void>;
/** Best-effort recursive delete of a skill's cloned directory. */
export declare function removeSkillDir(path: string): Promise<void>;
//# sourceMappingURL=manifest.d.ts.map
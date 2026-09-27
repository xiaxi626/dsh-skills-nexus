import type { OpsIO } from './ops-io.js';
import type { SkillEntry } from './types.js';
/** A zip archive failed validation or installation. */
export declare class ZipError extends Error {
    constructor(message: string);
}
/** Options for {@link installFromZip}. */
export interface ZipInstallOptions {
    /** Entry name override; when absent it is derived (see `deriveEntryName`). */
    name?: string;
    /**
     * Original upload file name, when there is one — used to derive the entry
     * name and recorded (with a `zip:` scheme) as the entry's `url`.
     */
    fileName?: string;
}
/** Outcome of a successful {@link installFromZip}. */
export interface ZipInstallResult {
    entry: SkillEntry;
    /** Link names created in the official skills root, in creation order. */
    links: string[];
    /** Non-fatal skips (symlink / `.git` entries, failed symlinks). */
    warnings: string[];
    /** Number of frontmatter fields the install-time normalization rewrote. */
    normalized: number;
    /** Number of skills discovered in the archive. */
    skills: number;
}
/**
 * Install a skill archive uploaded as a zip buffer (§9.2):
 *
 *   validate → extract to staging → discover → normalize frontmatter →
 *   atomic move into `repos/<name>/` → create links → manifest entry
 *
 * The entry is registered as `source: 'zip'` with empty `ref` / `gitUrl` /
 * `commit` (§5.3); everything else matches the git install path (same skill
 * rules, same normalization, same link naming). On any failure the staging
 * directory and — once moved — the destination are removed.
 */
export declare function installFromZip(buffer: Buffer, opts: ZipInstallOptions, io: OpsIO): Promise<ZipInstallResult>;
//# sourceMappingURL=zip.d.ts.map
import type { OpsIO } from './ops-io.js';
import type { SkillEntry } from './types.js';
/**
 * ZIP installation (§9) — a hand-written minimal PKZip reader plus the
 * `installFromZip` flow. Runtime dependency count stays at zero: only
 * `node:zlib` (inflateRaw) is used for the deflate method.
 *
 * Threat model and defenses (§9.1), enforced before anything is written:
 *   - zip slip (`..` / absolute entry names) — every entry resolves into the
 *     staging directory or the whole archive is rejected;
 *   - symlink entries — skipped entirely (never extracted);
 *   - `.git` entries — skipped (a zip install must not drop git state into
 *     `repos/`, §5.3/§9.3);
 *   - decompression bombs — 200MB upload, 500MB total, 100MB per file,
 *     5000 entries, and `inflateRaw` output bounded per file as a second
 *     line of defense;
 *   - encryption — any encrypted entry rejects the archive; only the stored
 *     (0) and deflate (8) methods are accepted; zip64 is rejected.
 *
 * The archive is staged under `<NEXUS_HOME>/.zip-stage-*` and moved into
 * `repos/<name>/` atomically (rename) only after validation, discovery and
 * normalization succeeded. Any failure removes the staging directory and —
 * once moved — the destination (the add.ts rollback standard, §9.2).
 */
/** Upload cap (§9.1) — also the add-zip route's request-body cap. */
export declare const MAX_ARCHIVE_BYTES: number;
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
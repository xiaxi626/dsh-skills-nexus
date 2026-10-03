import type { OpsIO } from './ops-io.js';
/**
 * `export` — channel C of the sources & packages design
 * (`docs/sources-and-packages.md`): turn one or more registered
 * entries into a portable package.
 *
 * A package is a transport container, **not** a second install format. It
 * carries the skill files *and* a `nexus-package.json` label recording where
 * each entry came from (`url` / `gitUrl` / `ref` / `commit` / `subdir`), whether
 * it was enabled, and which links it owned. The importer prefers to re-fetch
 * from that recorded source; the files are the fallback. That is the whole
 * point of the label: a bare directory can never be turned back into an
 * updatable entry, a labelled package can.
 *
 * Two rules follow from "the label is the value, the files are the fallback":
 *
 *   - **no `.git` and no credentials** ever enter a package. History is not
 *     what makes an entry updatable here — a recorded remote is — and shipping
 *     a clone would smuggle `.git/config` credentials into a file the user is
 *     about to hand to someone else;
 *   - **external entries are never exported.** An `ownership: 'external'` entry
 *     only links a directory the user owns; copying it would cross the one
 *     boundary the marker exists to protect. `--all` records it in `skipped[]`,
 *     asking for it by name is an error.
 */
/** Label schema id written into every package. */
export declare const PACKAGE_SCHEMA = "dsh-skills-nexus/package";
/** Label schema version; a reader must refuse a higher one. */
export declare const PACKAGE_VERSION = 1;
/** File name of the label inside the package. */
export declare const PACKAGE_MANIFEST = "nexus-package.json";
/** One skill the package carries, as the exporter saw it. */
export interface PackageSkill {
    /** Skill root inside the package, e.g. `skills/foo/bar` (`.` root → entry root). */
    root: string;
    /** Skill name the importer should use when rebuilding links. */
    name: string;
    description: string;
    /** Link names that existed when the entry was exported (may be empty). */
    links: string[];
}
/** One entry inside a package — the label's unit. */
export interface PackageEntry {
    /** Entry name (also the directory name under `skills/`). */
    name: string;
    /** Spec the user originally passed, e.g. `github:owner/repo#main`. */
    url: string;
    /** Resolved remote; empty for entries nexus never cloned from git. */
    gitUrl: string;
    ref: string;
    /** Informational only — the importer re-resolves `ref` instead of trusting it. */
    commit: string;
    subdir?: string;
    /** Whether the entry had at least one link when it was exported. */
    enabled: boolean;
    skills: PackageSkill[];
}
/** An entry deliberately left out of the package, and why. */
export interface PackageSkipped {
    name: string;
    reason: string;
}
/** The package label (`nexus-package.json`). */
export interface NexusPackage {
    schema: string;
    version: number;
    exportedAt: string;
    generator: string;
    skipped: PackageSkipped[];
    entries: PackageEntry[];
}
/** `export` could not build the package it was asked for. */
export declare class ExportError extends Error {
    constructor(message: string);
}
export interface ExportOptions {
    /** Entry names to export, in the order given. Ignored when `all` is set. */
    names?: string[];
    /** Export every managed entry (external ones are skipped, not exported). */
    all?: boolean;
    /** Output path: `*.zip` builds an archive, anything else a directory tree. */
    out: string;
    io?: OpsIO;
}
export interface ExportResult {
    out: string;
    format: 'zip' | 'directory';
    /** Entries written into the package. */
    entries: number;
    /** Payload files written (the label is not counted). */
    files: number;
    /** Entries left out on purpose; already recorded in the label. */
    skipped: PackageSkipped[];
}
/**
 * Build a package from the manifest. Read-only with respect to nexus state:
 * nothing is registered, nothing is linked, and the only thing written is the
 * package itself.
 */
export declare function exportSkills(options: ExportOptions): Promise<ExportResult>;
//# sourceMappingURL=export.d.ts.map
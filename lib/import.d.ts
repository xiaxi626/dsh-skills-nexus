import type { OpsIO } from './ops-io.js';
import type { ImportDecision } from './import-decision.js';
import type { PackageSkipped } from './export.js';
/**
 * `import` — channel C of the sources & packages design
 * (`docs/sources-and-packages.md`): rebuild entries from a
 * package that `export` produced, or from a package somebody else did.
 *
 * What makes this more than "unzip into repos/" is the label. When the package
 * carries `nexus-package.json` and the remote it records answers, the entry is
 * rebuilt through the **same install path as `add`** (`src/install.ts`) — a real
 * clone, updatable and switchable. Only when there is no source, or it cannot be
 * reached, does the payload land as a snapshot; even then the label's `enabled`
 * flag and link names are restored, so the receiving machine ends up looking
 * like the sending one. A package without a label (a bare zip, another tool's
 * export) is a *bare package*: its skills are found by the peel scan and land as
 * snapshots.
 *
 * Two boundaries from §4.2:
 *   - **the peel scan lives here**, not in the installer's three discovery
 *     rules. Those must keep matching what the official provider finds, so they
 *     cannot be loosened; a package is a foreign artifact and needs a more
 *     forgiving search (`skills/<name>/SKILL.md` is three levels deep and must
 *     work, and so must `repo-main/skills/<name>/SKILL.md`).
 *   - **`--dry-run` decides without touching nexus state.** It unpacks the
 *     archive into a temporary directory (that is how the payload is inspected
 *     at all) and it probes the recorded remote, but it registers nothing,
 *     clones nothing and links nothing.
 */
/** How long a `--dry-run` remote probe may take before it counts as a timeout. */
export declare const URL_CHECK_TIMEOUT_MS = 5000;
/** How many wrapper directories the peel scan removes before giving up. */
export declare const MAX_PEEL_DEPTH = 3;
export type ImportErrorCode = 'package-not-found' | 'invalid-package' | 'newer-package' | 'no-skill-found' | 'skill-nested-too-deep' | 'already-registered' | 'collision' | 'install-refused' | 'nothing-to-import';
/** A package could not be read, understood or applied. */
export declare class ImportError extends Error {
    /** Stable machine-readable code (§10.4). */
    readonly code: ImportErrorCode;
    constructor(code: ImportErrorCode, message: string);
}
/**
 * The verdict of a plan (and the four-state rule behind it) lives in
 * `src/import-decision.ts`: the panel renders the same sentence as the CLI's
 * `--dry-run`, and that module is free of the node-only dependencies this core
 * carries. Re-exported here so `import` keeps one import surface.
 */
export type { ImportDecision, SnapshotReason } from './import-decision.js';
/** One skill inside a planned entry, with the links it should end up under. */
export interface PlannedSkill {
    /** Skill name (frontmatter name, entry-name fallback). */
    name: string;
    /** Package-relative directory this skill lives in. */
    root: string;
    /** Link names the label recorded for it (empty for a bare package). */
    links: string[];
}
/** One entry the import would create. */
export interface ImportPlanEntry {
    /** Entry name that would be registered. */
    name: string;
    /** Package-relative skill root of the entry (`.` = package root). */
    root: string;
    /** `subdir` the label recorded, replayed on the git path. */
    subdir?: string;
    skills: PlannedSkill[];
    /** Whether the sending machine had this entry enabled. */
    enabled: boolean;
    decision: ImportDecision;
    /** True when the name (or repos/ directory) is already taken. */
    conflict: boolean;
    /** Payload files under this entry's root. */
    files: number;
}
/** What `--dry-run` reports and what the real run applies. */
export interface ImportPlan {
    source: string;
    format: 'zip' | 'directory';
    /** True when the package carried `nexus-package.json`. */
    labelled: boolean;
    /** True when the package lists sources but carries no skill content. */
    manifestOnly: boolean;
    entries: ImportPlanEntry[];
    /** Entries the exporting machine deliberately left out. */
    skipped: PackageSkipped[];
    /** Candidate root of a bare package (`undefined` for a labelled one). */
    candidate?: string;
    /** How many wrapper levels the peel scan removed. */
    peel: number;
    files: number;
}
export interface ImportOptions {
    /** Package path: a `.zip` archive or a directory tree. */
    source: string;
    /** Decide only; nothing is cloned, copied, registered or linked. */
    dryRun?: boolean;
    /** Land everything as a snapshot, even when the label records a remote. */
    noRemote?: boolean;
    /** Skip the remote probe entirely (offline: no waiting, no verdict). */
    noNetCheck?: boolean;
    /** Override the entry name (single-entry packages only). */
    name?: string;
    /** Restrict a labelled package to one entry name. */
    subdir?: string;
    /** One entry per skill instead of one entry per candidate root. */
    each?: boolean;
    /** Replace an existing entry of the same name. */
    force?: boolean;
    /** Skip the large-collection confirmation during a git install. */
    yes?: boolean;
    io: OpsIO;
}
export interface ImportedEntry {
    name: string;
    kind: 'git' | 'snapshot';
    links: string[];
    enabled: boolean;
    /** Where a snapshot's files came from, for the summary line. */
    path: string;
}
export interface ImportResult {
    source: string;
    installed: ImportedEntry[];
    skipped: PackageSkipped[];
    /** Entries that could not be installed; the run continues with the rest. */
    failed: Array<{
        name: string;
        reason: string;
    }>;
}
/** A package unpacked somewhere the scanner can read it. */
export interface StagedPackage {
    source: string;
    format: 'zip' | 'directory';
    /** Directory holding the package contents (label + payload). */
    root: string;
    /** Removes the temporary copy; a no-op for a directory source. */
    cleanup: () => Promise<void>;
}
/**
 * Make the package readable as a directory tree. An archive is unpacked into a
 * fresh temporary directory (`readZip` has already enforced every static rule
 * and the size caps of §5); a directory source is used in place.
 */
export declare function stagePackage(source: string): Promise<StagedPackage>;
/** Decide what an import would do, without doing any of it. */
export declare function planStaged(staged: StagedPackage, options: ImportOptions): Promise<ImportPlan>;
/**
 * Stage → plan → apply → clean up. With `dryRun` the plan comes back and nothing
 * else happens (`result` is `undefined`).
 */
export declare function importPackage(options: ImportOptions): Promise<{
    plan: ImportPlan;
    result?: ImportResult;
}>;
//# sourceMappingURL=import.d.ts.map
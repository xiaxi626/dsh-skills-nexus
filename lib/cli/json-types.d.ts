/**
 * The `--json` report contracts, version 1 (P0 §4).
 *
 * These types are the stable half of the machine interface: `doctor --json`
 * already promised `version: 1`, and the write commands now make the same
 * promise — field names and types here are contract, field order and the
 * wording of `error` strings are not (P0 §2.2).
 *
 * Every report carries `version: 1` as a literal type, so a future breaking
 * change has to touch each report object at its construction site rather than
 * being silently forgotten in a type-only refactor. `JsonReport` is the union
 * the emitter accepts, which is what keeps a new command from inventing a shape
 * outside the contract.
 *
 * Deliberately NOT here: `doctor --json`, whose `DoctorReport` already lives
 * next to its checks in `commands/doctor.ts` and is emitted unchanged. The two
 * share the `version` mechanism and the 2-space framing, but they describe
 * different things — `doctor` reports system state, these report what an
 * operation just did (P0 §2.3).
 */
/** Any shape `emitJson` may write: all of them carry the version. */
export type JsonReport = ListJsonReport | AddJsonReport | UpdateJsonReport | RollbackJsonReport | RemoveJsonReport | ToggleJsonReport | PurgeJsonReport | ProjectListJsonReport | ProjectLinkJsonReport | ProjectRemoveJsonReport | ProjectToggleJsonReport;
/**
 * The unexpected-fatal payload (P0 §4.6): written to **stderr** with exit 1
 * (or exit 2 when it is really a usage error), so a consumer that captured only
 * stdout sees an empty stream rather than half a report.
 */
export interface JsonError {
    version: 1;
    error: {
        message: string;
    };
}
/** One symlink exposing part of an entry's clone (mirrors `ListLink`). */
export interface ListJsonLink {
    linkName: string;
    target: string;
}
/** The last `check-updates` comparison for an entry, or `null` if never checked. */
export interface ListJsonUpdate {
    hasUpdate: boolean;
    latestCommit: string | null;
    checkedAt: string;
}
/**
 * One managed entry. `hasGitSource` is the server-side predicate
 * (`entry.gitUrl.length > 0`) — the same field `GET /list` serves and the
 * panel reads; it is deliberately NOT derived from `url`, which every entry
 * has and which is never empty.
 *
 * `ownership: 'external'` marks an entry that merely links a directory the
 * user owns (a `--link-only` adoption): its `gitUrl` is empty, so
 * `hasGitSource` is false, and `remove` never deletes the directory itself.
 */
export interface ListJsonEntry {
    name: string;
    url: string;
    ref: string;
    subdir: string | null;
    commit: string | null;
    /** Present and true only for an explicit package commit lock. */
    locked?: boolean;
    hasGitSource: boolean;
    ownership: 'managed' | 'external';
    enabled: boolean;
    links: ListJsonLink[];
    update: ListJsonUpdate | null;
    /** Hierarchical group path, set for external entries from the link channel. */
    groupPath?: string[];
    /** Absolute path to the external skill directory, set for external entries. */
    externalDir?: string;
}
export interface ListJsonReport {
    version: 1;
    entries: ListJsonEntry[];
}
/** Read-only metadata parsed from a SKILL.md (or flat .md) file. */
export interface ProjectSkillJson {
    name: string;
    description: string;
    skillFile: string;
    resourceBase: string;
    valid: boolean;
    invalidName?: string;
    error?: string;
}
/** A skill the project folder itself provides, with its link state. */
export interface ProjectFolderSkillJson extends ProjectSkillJson {
    linked: boolean;
    linkName: string | null;
    disabled: boolean;
}
/** One entry in `<project>/.dsh/skills`, as the filesystem reports it. */
export interface ProjectListJsonEntry {
    name: string;
    /** Absolute path of the entry itself. */
    path: string;
    kind: 'link' | 'files';
    /** Absolute link target, or null for user files and unrecoverable links. */
    target: string | null;
    /** True when a link's target is missing or is not a directory. */
    dangling: boolean;
    /** True for active entries; false for a link parked under `skills-disabled`. */
    enabled: boolean;
    /** Parsed metadata when the entry (or a link's target) is a skill, else null. */
    skill: ProjectSkillJson | null;
}
export interface ProjectListJsonReport {
    version: 1;
    projectRoot: string;
    /** Skills provided by the project folder itself (read-only view). */
    folderSkills: ProjectFolderSkillJson[];
    entries: ProjectListJsonEntry[];
}
/**
 * One planned/executed project link. The status keeps the plan's verdict after
 * execution — `link` and `replace` mean "created" and "repointed", and an
 * `error` marks a result that was attempted and failed.
 */
export interface ProjectLinkJsonResult {
    name: string;
    target: string | null;
    status: 'link' | 'replace' | 'unchanged' | 'collision' | 'invalid';
    error?: string;
}
export interface ProjectLinkJsonReport {
    version: 1;
    projectRoot: string;
    source: string;
    results: ProjectLinkJsonResult[];
    summary: {
        linked: number;
        replaced: number;
        unchanged: number;
        failed: number;
    };
}
/** `not-a-link` is the project scope's extra outcome: user content was refused. */
export type ProjectRemoveJsonStatus = 'removed' | 'not-found' | 'not-a-link';
export interface ProjectRemoveJsonResult {
    name: string;
    status: ProjectRemoveJsonStatus;
    error?: string;
}
export interface ProjectRemoveJsonReport {
    version: 1;
    results: ProjectRemoveJsonResult[];
    summary: {
        removed: number;
        failed: number;
    };
}
/** `failed` is set when the move itself threw (permissions, cross-volume). */
export type ProjectToggleJsonStatus = 'enabled' | 'disabled' | 'already-enabled' | 'already-disabled' | 'not-found' | 'not-a-link' | 'not-files' | 'collision' | 'failed';
export interface ProjectToggleJsonResult {
    name: string;
    status: ProjectToggleJsonStatus;
    /** The state the command asked for (`enable` → true, `disable` → false). */
    enabled: boolean;
    error?: string;
}
export interface ProjectToggleJsonReport {
    version: 1;
    projectRoot: string;
    results: ProjectToggleJsonResult[];
    summary: {
        enabled: number;
        disabled: number;
        failed: number;
    };
}
/** Per-spec install result. `status` decides which of the other fields are set. */
export interface AddJsonResult {
    /** The spec exactly as it was given on the command line. */
    spec: string;
    status: 'added' | 'skipped' | 'failed';
    /** Entry name — set on `added`. */
    name?: string;
    /** Resolved commit of the install — set on `added` when git could report one. */
    commit?: string;
    /** Resolved ref (the detected default branch when the spec pinned none). */
    ref?: string;
    /** Repo-relative skill root, set only for a `--subdir` install. */
    subdir?: string;
    /** Link names created in the official skills root — set on `added`. */
    links?: string[];
    /** The install core's stop reason, set on `failed`/`skipped` (P0 §4.2). */
    code?: string;
    /** Human-readable reason; wording is explicitly not contract (P0 §2.2). */
    error?: string;
}
export interface AddJsonReport {
    version: 1;
    results: AddJsonResult[];
    summary: {
        added: number;
        skipped: number;
        failed: number;
    };
}
export type UpdateJsonStatus = 'updated' | 'up-to-date' | 'pinned' | 'failed';
export interface UpdateJsonResult {
    name: string;
    status: UpdateJsonStatus;
    ref: string;
    /** Commit before the operation; `null` when the clone had no readable HEAD. */
    fromCommit: string | null;
    /** Commit after it; equal to `fromCommit` for a no-op, `null` on failure. */
    toCommit: string | null;
    error?: string;
}
export interface UpdateJsonReport {
    version: 1;
    results: UpdateJsonResult[];
    summary: {
        updated: number;
        failed: number;
    };
}
/** rollback 的方向是当前版本 → 恢复版本，而非原操作方向。 */
export interface RollbackJsonResult {
    name: string;
    status: 'rolled-back' | 'failed';
    fromCommit: string | null;
    toCommit: string | null;
    fromRef: string | null;
    toRef: string | null;
    wasDirty?: boolean;
    links?: string[];
    message?: string;
    error?: string;
}
export interface RollbackJsonReport {
    version: 1;
    results: RollbackJsonResult[];
}
export type RemoveJsonStatus = 'removed' | 'not-found' | 'failed';
export interface RemoveJsonResult {
    name: string;
    status: RemoveJsonStatus;
    /** Symlink names deleted with the entry — set on `removed`. */
    links?: string[];
    error?: string;
}
export interface RemoveJsonReport {
    version: 1;
    results: RemoveJsonResult[];
    summary: {
        removed: number;
        failed: number;
    };
}
export type ToggleJsonStatus = 'toggled' | 'already' | 'not-found' | 'failed';
export interface ToggleJsonResult {
    name: string;
    action: 'enable' | 'disable';
    status: ToggleJsonStatus;
    /** The resulting state: what the entry has now, not what was asked for. */
    enabled: boolean;
    /** Symlinks created (enable) or removed (disable); 0 unless `toggled`. */
    linksChanged: number;
    already: boolean;
    error?: string;
}
export interface ToggleJsonReport {
    version: 1;
    results: ToggleJsonResult[];
    summary: {
        toggled: number;
        already: number;
        failed: number;
    };
}
/** One file or directory the purge scan found or removed. */
export interface PurgeJsonFile {
    path: string;
    size: number;
    category: 'exports' | 'corrupt-manifest' | 'upload-temp' | 'orphan-rollback';
}
/** One item the purge tried but failed to delete. */
export interface PurgeJsonFailed {
    path: string;
    /** Human-readable error; wording is not contract (P0 §2.2). */
    error: string;
}
/**
 * The `purge --json` report. `files` lists what the scan found (dry-run) or
 * what was actually removed (`--yes`); `removed` is the count of items
 * successfully deleted (0 in dry-run mode). `failed` lists items that the
 * purge attempted to delete but could not — empty on success or dry-run.
 */
export interface PurgeJsonReport {
    version: 1;
    files: PurgeJsonFile[];
    totalSize: number;
    removed: number;
    failed: PurgeJsonFailed[];
}
//# sourceMappingURL=json-types.d.ts.map
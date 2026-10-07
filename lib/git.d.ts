/**
 * Git operations for managing cloned skill repos.
 *
 * Uses `execFile` with argument arrays (no shell) so user-controlled refs/URLs
 * cannot trigger shell injection — and, because argument arrays alone do not
 * stop *argument injection*, the values themselves are validated where they
 * enter: repo specs/refs are refused when they look like Git options, contain
 * control characters or use the `<transport>::<address>` helper syntax, and
 * `scheme://` URLs are restricted to an allowlist.
 */
interface RetryOptions {
    /** Number of retries *after* the first attempt (retries: 1 → 2 attempts). */
    retries: number;
    /** Base delay in ms; grows exponentially as `minDelay * 2 ** attempt`. */
    minDelay: number;
}
/**
 * Retry an async operation with exponential backoff.
 *
 * Retries on *any* thrown error, so callers must only wrap operations whose
 * failures are plausibly transient (network jitter). A deterministic failure
 * (e.g. `git clone --branch <commit-sha>`, which git always rejects) must NOT
 * be wrapped — every attempt would just repeat the same failure after a delay.
 */
export declare function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T>;
export interface GitSpec {
    /** Original spec string the user passed. */
    raw: string;
    /** Normalized URL safe to hand to `git clone`. */
    url: string;
    /** Branch / tag / commit. */
    ref: string;
}
/** Repo slug derived from the URL, e.g. `owner/repo` → `repo`. */
export declare function repoSlug(spec: GitSpec): string;
/**
 * Convert an arbitrary name into a valid DSH skill name (kebab-case).
 *
 * Aligns with the official `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` —
 * only lowercase letters, digits, and single dashes between segments.
 * No dots, underscores, or consecutive dashes.
 */
export declare function sanitizeName(raw: string): string;
/**
 * Normalize the many accepted input forms into a cloneable git URL + ref:
 *   github:owner/repo          (GitHub shorthand)
 *   github:owner/repo#branch
 *   https://github.com/owner/repo
 *   https://gitlab.com/group/project   (any git host)
 *   https://github.com/owner/repo/tree/main/skills        (tree path ignored)
 *   git+https://github.com/owner/repo.git
 *   git@gitlab.com:group/project.git   (SSH, any host)
 *   owner/repo                 (GitHub only — resolves to github.com)
 */
export declare function parseGitSpec(input: string, refFallback?: string): GitSpec;
/**
 * Detect the default branch of a remote repo via `git ls-remote --symref`.
 * Returns e.g. `main` or `master`. Falls back to `main` on any failure.
 */
export declare function getDefaultBranch(url: string): Promise<string>;
/**
 * Normalize a `--subdir` value into a repository-relative path.
 *
 * Separators are unified to `/` and empty / `.` segments dropped, but every
 * remaining segment keeps its literal meaning — the value is never interpreted
 * as a glob pattern. Absolute paths, drive and UNC prefixes, `..` segments and
 * control characters are rejected so the path can never escape the clone.
 * Returns `.` when the value normalizes to the repository root.
 */
export declare function normalizeSubdir(raw: string): string;
/**
 * True only for a *real* directory: a symlink (even one pointing at a
 * directory) and a missing path both return false.
 *
 * Used on the resolved `--subdir` skill root. Git can materialize a committed
 * symlink there, and following it would let a crafted repository point the
 * DSH catalog at arbitrary local paths; ancestor components of a checked-out
 * path are always real directories, so requiring the final component itself
 * to be a real directory closes the escape.
 */
export declare function isRealDirectory(dir: string): Promise<boolean>;
/** Outcome of {@link cloneRepo}: how much of the repository landed on disk. */
export interface CloneResult {
    /**
     * `sparse` — cone-mode patterns restricted the checkout to the requested
     * subdirectory (plus files Git keeps beside it in ancestor directories);
     * `full` — the entire worktree was materialized.
     */
    mode: 'full' | 'sparse';
    /** Non-fatal caveats to show the user (degraded or ignored optimizations). */
    warnings: string[];
}
/** An exact package commit is no longer fetchable from its recorded remote. */
export declare class CommitUnavailableError extends Error {
    readonly commit: string;
    constructor(commit: string, message: string);
}
/** This Git cannot run the sparse step, so the clone is simply complete. */
export declare const SPARSE_UNSUPPORTED_WARNING = "sparse checkout is unavailable in this Git \u2014 the whole repository was materialized";
/**
 * Reported when the remote ignores `--filter`: the worktree is still sparse,
 * but the object database may hold every blob, so no download saving is claimed.
 */
export declare const FILTER_IGNORED_WARNING = "the remote ignored the blob filter \u2014 this clone may have downloaded the whole repository";
/**
 * Shallow-clone `spec` into `dest`.
 *
 * Without `options.subdir` this is the original whole-repository clone. With a
 * subdir it uses a partial clone plus cone-mode sparse-checkout, so only the
 * requested directory tree — plus the files Git keeps directly inside the
 * repository root and the target's ancestor directories — is materialized:
 *
 *   git clone --depth 1 --filter=blob:none --no-checkout --branch <ref> <url> <dest>
 *   git sparse-checkout set --cone [--skip-checks] -- <subdir>
 *   git checkout <ref>
 *
 * The rules are always installed *before* the first checkout: a repository is
 * never materialized in full and then pruned. Capabilities are probed rather
 * than assumed (see the two helpers above): a Git without `sparse-checkout`
 * falls back to a normal clone, and a worktree-less clone that turns out to
 * lack `--cone` is completed in place instead of being downloaded twice.
 */
export declare function cloneRepo(spec: GitSpec, dest: string, options?: {
    subdir?: string;
    exactCommit?: string;
}): Promise<CloneResult>;
/**
 * Resolve the commit SHA a remote currently advertises for `ref`, via
 * `git ls-remote`. Returns `undefined` on any failure (offline, private repo,
 * a raw commit SHA the server does not advertise, or timeout) so callers can
 * treat "unknown" as "skip" rather than an error. Bounded by a 15s timeout so a
 * hung network cannot stall `doctor --updates`.
 */
export declare function lsRemoteCommit(url: string, ref: string): Promise<string | undefined>;
/** Fast-forward pull an existing clone. */
export declare function pullRepo(dest: string): Promise<void>;
/** Full commit SHA currently checked out in a clone. */
export declare function getHeadCommit(dest: string): Promise<string>;
/**
 * True when the clone is on a detached HEAD — i.e. it was cloned at a tag or
 * a raw commit SHA, which `git pull` cannot fast-forward. Branch clones have
 * a symbolic HEAD and return false. Other failures (broken clone, no git)
 * also yield true, but callers always run `getHeadCommit` first, which throws
 * before reaching this point in those cases.
 */
export declare function isDetachedHead(dest: string): Promise<boolean>;
/** Resolve a local ref (branch / tag / commit) to its commit SHA. */
export declare function resolveRefCommit(dest: string, ref: string): Promise<string>;
/** Check out a local ref, leaving the clone detached (restores a pinned tag/commit). */
export declare function checkoutRef(dest: string, ref: string): Promise<void>;
/**
 * True when the clone has local changes — modified tracked files or
 * untracked files. Install-time normalization rewrites `SKILL.md` in place,
 * so managed clones are typically dirty right after `add`.
 */
export declare function isDirtyWorktree(dest: string): Promise<boolean>;
/**
 * Discard all local changes (tracked and untracked) so pull / checkout can
 * proceed. Clones under `repos/` are nexus-managed: local edits are drift by
 * definition, and normalization artifacts are regenerated by the
 * re-normalize step in `update` after the pull.
 */
export declare function discardLocalChanges(dest: string): Promise<void>;
/**
 * Fetch `ref` from `origin` so the target commit becomes resolvable locally.
 *
 * A `--depth 1` clone holds no history, so switching to a branch or tag the
 * clone has never seen requires a fetch first — without it `git checkout
 * <tag>` fails because the tag object is absent (the real bug the v1 design
 * missed).
 *
 * Explicitly-mapped refspecs are the only form whose result outlives the
 * command: a bare-name fetch (`git fetch origin <ref>`) writes FETCH_HEAD and
 * creates *no* local ref — verified against branches, lightweight tags and
 * annotated tags — so `rev-parse <ref>^{commit}` still fails afterwards. The
 * two mapped attempts cover the two namespaces; a third unmapped fetch
 * covers raw commit SHAs (fetched as objects, resolvable by SHA without any
 * ref).
 *
 * Attempts stop at the first success — the namespaces are mutually
 * exclusive, and a mismatched attempt fails deterministically ('couldn't
 * find remote ref', exit 128) after a wasted round-trip. Failures are
 * silent: the returned outcome tells the caller which namespace landed, and
 * the caller resolves the target afterwards (see
 * {@link resolveSwitchTarget}) — reporting `ref-not-found` when nothing
 * matches. That also covers an offline switch to a ref that is already
 * present locally: all three fetches fail, resolution still succeeds.
 */
export declare function fetchRepo(dest: string, ref: string): Promise<FetchOutcome>;
/**
 * Fetch one remote comparison target into FETCH_HEAD without updating a local
 * branch or tag. Partial clones retain their blob:none filter; the subsequent
 * diff may therefore lazy-fetch only the blobs it actually compares.
 */
export declare function fetchDiffTarget(dest: string, ref: string, options?: {
    exactBranch?: boolean;
}): Promise<string>;
/**
 * Render a deterministic, non-interactive commit diff. External diff drivers
 * and textconv filters are disabled because repository-controlled config or
 * attributes must not execute helpers while previewing untrusted content.
 */
export declare function diffRepo(dest: string, fromCommit: string, toCommit: string, options?: {
    stat?: boolean;
    pathspec?: string;
}): Promise<string>;
/** What {@link fetchRepo} managed to land locally — the input to
 *  {@link resolveSwitchTarget}. */
export type FetchOutcome = 'branch' | 'tag' | 'sha' | 'none';
/** Resolved switch target — see {@link resolveSwitchTarget}. */
export interface SwitchTarget {
    /** Commit SHA the target resolves to. */
    commit: string;
    /**
     * `branch` — attach a local branch aligned with `origin/<ref>`;
     * `pin` — detached checkout of {@link commit} (tag / raw SHA).
     */
    kind: 'branch' | 'pin';
}
/**
 * DWIM-resolve the ref passed to `switchVersion` into a concrete commit,
 * guided by what {@link fetchRepo} landed.
 *
 * Resolution follows the landing namespace — a landed branch can only be the
 * one just fetched into `origin/<ref>`, a landed tag the one just fetched
 * into `refs/tags/<ref>`. That also keeps a stale `origin/<ref>` (left
 * behind by a since-deleted remote branch) from being mistaken for a fresh
 * fetch. When nothing landed (`none` — offline, or the remote has no such
 * ref) every namespace is tried against the local clone so an already
 * present ref can still be switched to; the caller's `refType` hint only
 * orders that fallback (§8.2 — a hint, never persisted).
 *
 * Returns `undefined` when nothing resolves; the caller reports
 * `ref-not-found` with zero changes.
 */
export declare function resolveSwitchTarget(dest: string, ref: string, landed: FetchOutcome, hint?: 'branch' | 'tag' | 'commit'): Promise<SwitchTarget | undefined>;
/**
 * Put the clone on a local branch aligned with `origin/<branch>`.
 *
 * `git checkout -B` alone is not enough after a switch: (a) it does not set
 * up tracking (verified — a fresh `-B dev origin/dev` leaves `dev` without
 * an upstream), and (b) the clone's configured fetch refspec still points at
 * the *previous* ref — a tag clone keeps `+refs/tags/<tag>:refs/tags/<tag>`
 * — so the fetch half of a later `git pull` would update the wrong ref and
 * the merge would fail with "not possible to fast-forward" (or silently
 * update nothing). The refspec is normalized first: `branch
 * --set-upstream-to` refuses to run while `origin/<branch>` is not
 * recognised through the remote's refspec ("starting point ... is not a
 * branch"), and the upstream is what `pullRepo` needs.
 *
 * The caller must have fetched `branch` (see {@link fetchRepo}) so
 * `origin/<branch>` exists.
 */
export declare function checkoutBranch(dest: string, branch: string): Promise<void>;
/**
 * Name of the branch HEAD is attached to, or `undefined` when HEAD is
 * detached (tag / commit pin) or the name is not safe to reuse as a Git
 * argument (see `isSafeRef`).
 */
export declare function getCurrentBranch(dest: string): Promise<string | undefined>;
/** 按精确 commit 恢复 HEAD；branch 恢复不得取当前 remote tip。 */
export declare function restoreCheckout(dest: string, commit: string, branch?: string): Promise<void>;
export declare const ROLLBACK_REF_PREFIX = "refs/nexus/rollback/";
export declare function assertRollbackRef(ref: string): void;
export declare function createRollbackAnchor(dest: string, ref: string, commit: string): Promise<void>;
export declare function deleteRollbackAnchor(dest: string, ref: string): Promise<void>;
export declare function rollbackAnchors(dest: string): Promise<string[]>;
export {};
//# sourceMappingURL=git.d.ts.map
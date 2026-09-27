/**
 * Git operations for managing cloned skill repos.
 *
 * Uses `execFile` with argument arrays (no shell) so user-controlled refs/URLs
 * cannot trigger shell injection.
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
 *   github:owner/repo
 *   github:owner/repo#branch
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/skills        (tree path ignored)
 *   git+https://github.com/owner/repo.git
 *   owner/repo
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
export {};
//# sourceMappingURL=git.d.ts.map
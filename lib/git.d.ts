/**
 * Git operations for managing cloned skill repos.
 *
 * Uses `execFile` with argument arrays (no shell) so user-controlled refs/URLs
 * cannot trigger shell injection.
 */
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
/** Convert a kebab/host-style name into a safe directory segment. */
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
/** Shallow-clone a repo at `ref` into `dest`. */
export declare function cloneRepo(spec: GitSpec, dest: string): Promise<void>;
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
//# sourceMappingURL=git.d.ts.map
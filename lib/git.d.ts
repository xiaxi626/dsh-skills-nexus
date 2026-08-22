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
//# sourceMappingURL=git.d.ts.map
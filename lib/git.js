import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
/** Repo slug derived from the URL, e.g. `owner/repo` → `repo`. */
export function repoSlug(spec) {
    const cleaned = spec.url.replace(/\.git$/, '').replace(/\/$/, '');
    const segments = cleaned.split('/');
    const last = segments[segments.length - 1] ?? '';
    return last || 'skill';
}
/**
 * Convert an arbitrary name into a valid DSH skill name (kebab-case).
 *
 * Aligns with the official `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` —
 * only lowercase letters, digits, and single dashes between segments.
 * No dots, underscores, or consecutive dashes.
 */
export function sanitizeName(raw) {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'skill';
}
/**
 * Normalize the many accepted input forms into a cloneable git URL + ref:
 *   github:owner/repo
 *   github:owner/repo#branch
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/skills        (tree path ignored)
 *   git+https://github.com/owner/repo.git
 *   owner/repo
 */
export function parseGitSpec(input, refFallback = 'main') {
    let raw = input.trim();
    let ref = refFallback;
    const hashIdx = raw.indexOf('#');
    if (hashIdx !== -1) {
        const r = raw.slice(hashIdx + 1).trim();
        if (r)
            ref = r;
        raw = raw.slice(0, hashIdx);
    }
    // Strip a `github:owner/repo` prefix → owner/repo shorthand.
    if (raw.startsWith('github:')) {
        raw = raw.slice('github:'.length);
    }
    let url;
    if (/^https?:\/\//.test(raw)) {
        // Allow a trailing /tree/<ref>/... subpath; keep only the repo root.
        const treeMatch = raw.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/[^/]+/);
        url = treeMatch ? `${treeMatch[1]}.git` : (raw.endsWith('.git') ? raw : `${raw}.git`);
    }
    else if (raw.startsWith('git+')) {
        url = raw.slice('git+'.length);
        if (!url.endsWith('.git'))
            url = `${url}.git`;
    }
    else if (raw.startsWith('git@') || raw.startsWith('ssh://')) {
        url = raw;
    }
    else if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
        // owner/repo shorthand → GitHub.
        url = `https://github.com/${raw}.git`;
    }
    else {
        url = raw;
    }
    return { raw: input, url, ref };
}
/**
 * Detect the default branch of a remote repo via `git ls-remote --symref`.
 * Returns e.g. `main` or `master`. Falls back to `main` on any failure.
 */
export async function getDefaultBranch(url) {
    try {
        const { stdout } = await execFileAsync('git', [
            'ls-remote', '--symref', url, 'HEAD',
        ]);
        // Output looks like:
        //   ref: refs/heads/main	HEAD
        //   abc123...	HEAD
        const match = stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
        if (match && match[1])
            return match[1];
    }
    catch {
        // Network issues, private repo, etc. — fall through to default.
    }
    return 'main';
}
/** Shallow-clone a repo at `ref` into `dest`. */
export async function cloneRepo(spec, dest) {
    // `--branch <ref>` works for both branches and tags. For a raw commit sha it
    // would fail; in that case fall back to cloning default branch + checkout.
    try {
        await execFileAsync('git', [
            'clone',
            '--depth', '1',
            '--branch', spec.ref,
            spec.url,
            dest,
        ]);
    }
    catch (err) {
        if (isCommitLike(spec.ref)) {
            await execFileAsync('git', ['clone', '--depth', '1', spec.url, dest]);
            await execFileAsync('git', ['fetch', '--depth', '1', 'origin', spec.ref], { cwd: dest });
            await execFileAsync('git', ['checkout', spec.ref], { cwd: dest });
            return;
        }
        throw err;
    }
}
/** Fast-forward pull an existing clone. */
export async function pullRepo(dest) {
    await execFileAsync('git', ['pull', '--ff-only'], { cwd: dest });
}
function isCommitLike(ref) {
    return /^[0-9a-f]{7,40}$/i.test(ref);
}
/* ------------------------------------------------------------------ */
/* Commit / HEAD helpers (version-lock bookkeeping)                    */
/* ------------------------------------------------------------------ */
/** Full commit SHA currently checked out in a clone. */
export async function getHeadCommit(dest) {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dest });
    return stdout.trim();
}
/**
 * True when the clone is on a detached HEAD — i.e. it was cloned at a tag or
 * a raw commit SHA, which `git pull` cannot fast-forward. Branch clones have
 * a symbolic HEAD and return false. Other failures (broken clone, no git)
 * also yield true, but callers always run `getHeadCommit` first, which throws
 * before reaching this point in those cases.
 */
export async function isDetachedHead(dest) {
    try {
        await execFileAsync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: dest });
        return false;
    }
    catch {
        return true;
    }
}
/** Resolve a local ref (branch / tag / commit) to its commit SHA. */
export async function resolveRefCommit(dest, ref) {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: dest });
    return stdout.trim();
}
/** Check out a local ref, leaving the clone detached (restores a pinned tag/commit). */
export async function checkoutRef(dest, ref) {
    await execFileAsync('git', ['checkout', ref], { cwd: dest });
}
/**
 * True when the clone has local changes — modified tracked files or
 * untracked files. Install-time normalization rewrites `SKILL.md` in place,
 * so managed clones are typically dirty right after `add`.
 */
export async function isDirtyWorktree(dest) {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dest });
    return stdout.trim().length > 0;
}
/**
 * Discard all local changes (tracked and untracked) so pull / checkout can
 * proceed. Clones under `repos/` are nexus-managed: local edits are drift by
 * definition, and normalization artifacts are regenerated by the
 * re-normalize step in `update` after the pull.
 */
export async function discardLocalChanges(dest) {
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: dest });
    await execFileAsync('git', ['clean', '-fd'], { cwd: dest });
}
//# sourceMappingURL=git.js.map
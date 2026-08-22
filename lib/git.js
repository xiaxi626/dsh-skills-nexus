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
/** Convert a kebab/host-style name into a safe directory segment. */
export function sanitizeName(raw) {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
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
//# sourceMappingURL=git.js.map
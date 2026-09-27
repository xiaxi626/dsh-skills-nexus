import { execFile } from 'node:child_process';
import { lstat, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
/**
 * Retry an async operation with exponential backoff.
 *
 * Retries on *any* thrown error, so callers must only wrap operations whose
 * failures are plausibly transient (network jitter). A deterministic failure
 * (e.g. `git clone --branch <commit-sha>`, which git always rejects) must NOT
 * be wrapped — every attempt would just repeat the same failure after a delay.
 */
export async function retry(fn, opts) {
    let lastErr;
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            if (attempt < opts.retries) {
                await new Promise((r) => setTimeout(r, opts.minDelay * 2 ** attempt));
            }
        }
    }
    throw lastErr;
}
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
/** URL schemes `nexus` may hand to Git; every other transport is refused. */
const ALLOWED_URL_SCHEMES = new Set(['https', 'http', 'ssh', 'git', 'file']);
/**
 * A ref must never look like a Git option or a transport helper: refs end up
 * in option-bearing argument positions (`--branch <ref>`, `fetch origin
 * <ref>`, `checkout <ref>`) where a `--` separator is not always available —
 * for `git checkout`, `--` already means "restore these paths" — so the value
 * itself is validated instead.
 */
function isSafeRef(ref) {
    return (ref.length > 0 &&
        !ref.startsWith('-') &&
        !ref.includes('::') &&
        !/[\u0000-\u001f]/.test(ref));
}
/** Throw unless `ref` is safe to place in Git's argument list. */
function assertSafeRef(ref) {
    if (!isSafeRef(ref)) {
        throw new Error(`Invalid ref ${JSON.stringify(ref)}: must not start with "-", ` +
            `contain "::" or control characters.`);
    }
}
/**
 * Throw unless `url` (parsed from `input`) is safe to hand to Git:
 * a leading `-` would be read as an option, `transport::address` (Git's
 * remote-ext) can run local commands, control characters never belong in a
 * URL, and `scheme://` URLs are allowlisted so unknown transports are
 * unreachable. Bare local paths and `file://` URLs stay supported.
 */
function assertSafeUrl(url, input) {
    if (url.startsWith('-') ||
        /^[a-z0-9][a-z0-9+.-]*::/i.test(url) ||
        /[\u0000-\u001f]/.test(url)) {
        throw new Error(`Invalid repo spec ${JSON.stringify(input)}: must not start with "-", ` +
            `contain control characters, or use "transport::address" syntax ` +
            `(e.g. "ext::").`);
    }
    const scheme = url.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1];
    if (scheme !== undefined && !ALLOWED_URL_SCHEMES.has(scheme.toLowerCase())) {
        throw new Error(`Unsupported URL scheme "${scheme}" in repo spec ${JSON.stringify(input)}: ` +
            `use an https, http, ssh, git or file URL (or a local path).`);
    }
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
        // Anything else is a local path, or an explicit `scheme://` URL that
        // `assertSafeUrl` allowlists below.
        url = raw;
    }
    // Whatever form the input had, only a safe URL and ref may reach Git: a
    // spec such as `ext::sh -c …` would otherwise run local commands through
    // Git's remote-ext helper, and a leading `-` would be read as an option.
    assertSafeUrl(url, input);
    assertSafeRef(ref);
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
        // The branch name is chosen by the remote: treat a hostile-looking one as
        // "unknown" rather than feeding it to later Git commands as a ref.
        if (match && match[1] && isSafeRef(match[1]))
            return match[1];
    }
    catch {
        // Network issues, private repo, etc. — fall through to default.
    }
    return 'main';
}
/**
 * Run Git and capture stdout+stderr instead of throwing on a non-zero exit.
 *
 * The capability probes below must read help text even though help exits
 * non-zero, and must never mistake an unrelated failure for "unsupported", so
 * callers match the *text*. Only a failure to spawn Git at all (ENOENT, EACCES)
 * propagates. The locale is pinned to C so message matching survives localized
 * installs, and `execFile` (argument arrays, no shell) is used so refs, URLs
 * and paths are never re-interpreted by a shell.
 */
async function runGit(args, cwd) {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd,
            env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        });
        return { ok: true, text: stdout + stderr };
    }
    catch (err) {
        const failure = err;
        // A numeric `code` is Git's own exit status; anything else means Git could
        // not be run at all, which is a hard error rather than a compatibility case.
        if (typeof failure.code !== 'number')
            throw err;
        return { ok: false, text: (failure.stdout ?? '') + (failure.stderr ?? '') };
    }
}
/** Run Git for a real work step; a non-zero exit throws Git's own message. */
async function git(args, cwd) {
    const { ok, text } = await runGit(args, cwd);
    if (!ok)
        throw new Error(text.trim() || `git ${args[0] ?? 'command'} failed`);
    return text;
}
/** Banner every `sparse-checkout` help output starts with. */
const SPARSE_USAGE = /usage: git sparse-checkout/;
/** What Git prints when the subcommand does not exist at all. */
const SPARSE_MISSING_COMMAND = /'sparse-checkout' is not a git command/;
/**
 * First half of the two-step capability probe: does this Git have
 * `sparse-checkout` at all?
 *
 * Runs in the *current* directory on purpose — that need not be a Git
 * repository, and `sparse-checkout set -h` would fail there with "not a git
 * repository" before revealing anything about its options.
 */
async function hasSparseCheckoutCommand() {
    const { text } = await runGit(['sparse-checkout', '-h']);
    if (SPARSE_USAGE.test(text))
        return true;
    if (SPARSE_MISSING_COMMAND.test(text))
        return false;
    throw new Error(`Unexpected "git sparse-checkout -h" output: ${text.trim()}`);
}
/**
 * Second half: which options does `set` accept? Must run inside the fresh clone,
 * because a subcommand's help requires a repository.
 *
 * `--cone` decides whether the sparse flow can run at all. `--skip-checks` is
 * what keeps literal directory names such as `skills/[draft]` from being read
 * as patterns, so it is passed whenever it is on offer.
 */
async function sparseSetCapabilities(dest) {
    const { text } = await runGit(['sparse-checkout', 'set', '-h'], dest);
    if (!SPARSE_USAGE.test(text)) {
        throw new Error(`Unexpected "git sparse-checkout set -h" output: ${text.trim()}`);
    }
    return {
        cone: /--(?:\[no-\])?cone\b/.test(text),
        skipChecks: /--skip-checks\b/.test(text),
    };
}
/**
 * Normalize a `--subdir` value into a repository-relative path.
 *
 * Separators are unified to `/` and empty / `.` segments dropped, but every
 * remaining segment keeps its literal meaning — the value is never interpreted
 * as a glob pattern. Absolute paths, drive and UNC prefixes, `..` segments and
 * control characters are rejected so the path can never escape the clone.
 * Returns `.` when the value normalizes to the repository root.
 */
export function normalizeSubdir(raw) {
    if (raw.length === 0 ||
        /^[\\/]/.test(raw) ||
        /^[a-z]:/i.test(raw) ||
        /[\u0000-\u001f]/.test(raw) ||
        raw.split(/[\\/]/).includes('..')) {
        throw new Error(`Invalid --subdir ${JSON.stringify(raw)}: must be a repo-relative path ` +
            `(no absolute path, no "..", no control characters).`);
    }
    return (raw
        .replaceAll('\\', '/')
        .split('/')
        .filter((segment) => segment !== '' && segment !== '.')
        .join('/') || '.');
}
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
export async function isRealDirectory(dir) {
    try {
        return (await lstat(dir)).isDirectory();
    }
    catch {
        return false;
    }
}
/** This Git cannot run the sparse step, so the clone is simply complete. */
export const SPARSE_UNSUPPORTED_WARNING = 'sparse checkout is unavailable in this Git — the whole repository was materialized';
/**
 * Reported when the remote ignores `--filter`: the worktree is still sparse,
 * but the object database may hold every blob, so no download saving is claimed.
 */
export const FILTER_IGNORED_WARNING = 'the remote ignored the blob filter — this clone may have downloaded the whole repository';
/**
 * Refuse to clone into an existing path.
 *
 * The sparse flow cleans up after itself on failure, so it must only ever run
 * against a directory this call created; deleting a caller's own directory
 * would be data loss. `add` passes a path it has just removed.
 */
async function assertCloneTargetAbsent(dest) {
    try {
        await lstat(dest);
    }
    catch {
        return;
    }
    throw new Error(`Refusing to clone into an existing path: ${dest}`);
}
/** Remove a worktree-less clone created by this call (retry / failure cleanup). */
async function discardClone(dest) {
    await rm(dest, { recursive: true, force: true });
}
/** Whole-repository shallow clone, unchanged. */
async function cloneFullRepo(spec, dest) {
    const branchClone = () => execFileAsync('git', ['clone', '--depth', '1', '--branch', spec.ref, spec.url, dest]);
    // `--branch <ref>` works for both branches and tags. A raw commit sha makes
    // git fail *deterministically* ("Remote branch <sha> not found"), so it must
    // not be retried — that would just repeat an identical failure after a delay.
    // Only branch/tag clones (where failure is likely network jitter) get a retry.
    try {
        if (isCommitLike(spec.ref)) {
            // A hex-looking ref could still be a real branch/tag name; try --branch
            // once (cheap, no retry) before falling back to the commit-sha strategy.
            await branchClone();
            return;
        }
        await retry(branchClone, { retries: 1, minDelay: 500 });
        return;
    }
    catch (err) {
        if (!isCommitLike(spec.ref))
            throw err;
        // Commit sha: shallow-clone the default branch, then fetch + checkout the pin.
        await execFileAsync('git', ['clone', '--depth', '1', spec.url, dest]);
        await execFileAsync('git', ['fetch', '--depth', '1', 'origin', spec.ref], { cwd: dest });
        await execFileAsync('git', ['checkout', spec.ref], { cwd: dest });
    }
}
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
export async function cloneRepo(spec, dest, options = {}) {
    const subdir = options.subdir === undefined ? undefined : normalizeSubdir(options.subdir);
    if (subdir === undefined || subdir === '.') {
        await cloneFullRepo(spec, dest);
        return { mode: 'full', warnings: [] };
    }
    if (!(await hasSparseCheckoutCommand())) {
        await cloneFullRepo(spec, dest);
        return { mode: 'full', warnings: [SPARSE_UNSUPPORTED_WARNING] };
    }
    await assertCloneTargetAbsent(dest);
    const warnings = [];
    try {
        const sparseClone = ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout'];
        const cloneOnce = async (args) => {
            const output = await git(args);
            if (/filtering not recognized by server/i.test(output)) {
                warnings.push(FILTER_IGNORED_WARNING);
            }
        };
        if (isCommitLike(spec.ref)) {
            // A hex-looking ref could still be a real branch/tag name; try `--branch`
            // once (cheap, no retry) before falling back to the commit-sha strategy.
            try {
                await cloneOnce([...sparseClone, '--branch', spec.ref, spec.url, dest]);
            }
            catch {
                await discardClone(dest);
                await cloneOnce([...sparseClone, spec.url, dest]);
                await git(['fetch', '--depth', '1', '--filter=blob:none', 'origin', spec.ref], dest);
            }
        }
        else {
            await retry(async () => {
                try {
                    await cloneOnce([...sparseClone, '--branch', spec.ref, spec.url, dest]);
                }
                catch (err) {
                    // A partial directory would make the next attempt fail on "already
                    // exists" instead of retrying the network.
                    await discardClone(dest);
                    throw err;
                }
            }, { retries: 1, minDelay: 500 });
        }
        const capabilities = await sparseSetCapabilities(dest);
        if (!capabilities.cone) {
            // Complete the clone that already exists instead of downloading a second
            // copy; the install is correct, just not sparse.
            warnings.push(SPARSE_UNSUPPORTED_WARNING);
            await git(['checkout', spec.ref], dest);
            return { mode: 'full', warnings };
        }
        const setArgs = ['sparse-checkout', 'set', '--cone'];
        if (capabilities.skipChecks)
            setArgs.push('--skip-checks');
        setArgs.push('--', subdir);
        await git(setArgs, dest);
        await git(['checkout', spec.ref], dest);
        return { mode: 'sparse', warnings };
    }
    catch (err) {
        await discardClone(dest);
        throw err;
    }
}
/**
 * Resolve the commit SHA a remote currently advertises for `ref`, via
 * `git ls-remote`. Returns `undefined` on any failure (offline, private repo,
 * a raw commit SHA the server does not advertise, or timeout) so callers can
 * treat "unknown" as "skip" rather than an error. Bounded by a 15s timeout so a
 * hung network cannot stall `doctor --updates`.
 */
export async function lsRemoteCommit(url, ref) {
    try {
        const { stdout } = await execFileAsync('git', ['ls-remote', url, ref], {
            timeout: 15000,
        });
        const line = stdout.trim().split('\n')[0];
        if (!line)
            return undefined;
        return line.split(/\s+/)[0];
    }
    catch {
        return undefined;
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
import type { CloneResult, GitSpec } from './git.js';
import type { OpsIO } from './ops-io.js';
import type { SkillEntry } from './types.js';
/**
 * The one filesystem-mutating install phase for a git source
 * (`clone → classify → normalize → register → link`).
 *
 * `docs/sources-and-packages.md` requires the new channels to
 * share one core: `import` (installing an entry from a recorded git source)
 * and `adopt` must reuse the very implementation the CLI already runs, the way
 * `src/switch-version.ts` and `src/remove.ts` already do — a second copy of
 * this sequence would drift from the first, and the two front ends would
 * disagree about what "installed" means.
 *
 * This module is that one implementation — `src/import.ts` installs a git
 * source without carrying a third copy of the logic.
 *
 * Both front ends call it: `src/cli/commands/add.ts` for the CLI and the `add`
 * route in `src/http/routes.ts` for the panel. The route used to carry a mirror
 * of it (`installGitCore`), which is exactly the drift §10.1 warns about — the
 * panel now installs through the same code path, and its former `400` codes are
 * rebuilt by the caller from `GitInstallResult.code` (see `GitInstallFailCode`).
 *
 * The caller keeps the read-only preflight and the locking: `add` validates
 * `--subdir`, detects the default branch and refuses re-registration /
 * collisions before anything is created, then holds the per-skill
 * cross-process lock around this call. Both front ends therefore resolve the
 * default branch themselves — the step is presentation-bound (the CLI wraps it
 * in its own spinner and its own "Detecting default branch" line) and must not
 * be duplicated inside this phase.
 *
 * This module is presentation-free: the clone's progress indicator comes from
 * the caller's `io.spin` (CLI = the same `withSpinner` it always used, HTTP =
 * run inline), so nothing here reaches for `process.stderr` or the CLI's
 * terminal helpers. The remaining `process.stderr.write` calls are the
 * diagnostics S3a moved verbatim and are deliberately left alone.
 */
/** Parameters of the filesystem-mutating install phase. */
export interface GitInstallParams {
    /** Spec as the caller gave it; recorded verbatim as the entry's `url`. */
    spec: string;
    gitSpec: GitSpec;
    /** Validated repo-relative skill root, or undefined for the clone root. */
    subdir: string | undefined;
    /** Entry name, already sanitized. */
    skillName: string;
    /** Directory name under <repos>/ — already sanitized and uniqueness-checked. */
    path: string;
    /** The caller's explicit --name, when it passed one (may be undefined). */
    name: string | undefined;
    /** Last path segment of `subdir`, when there is one. */
    subdirLeaf: string | undefined;
    /** Skip the large-collection confirmation. */
    yes: boolean | undefined;
    /** Exact package commit to fetch and check out detached. */
    exactCommit?: string;
    /** Mark the manifest entry as explicitly locked to `exactCommit`. */
    locked?: boolean;
    io: OpsIO;
}
export interface GitInstallResult {
    /**
     * Which of the three outcomes the inline flow used to report through
     * `AddResult` this run produced:
     *
     *   - `installed` — the entry was registered and its links created; `entry`,
     *     `links` and `normalized` are populated.
     *   - `skipped` — the clone was removed and nothing was registered because a
     *     confirmation was declined (the DSH-plugin wrapper, or the
     *     large-collection guard): the two former `{ status: 'skipped' }` paths.
     *   - `failed` — the clone was removed and nothing was registered (the
     *     `--subdir` is not a real directory, the repo is neither a SKILL.md repo
     *     nor a DSH plugin, or it yields zero installable skills): the former
     *     `{ status: 'failed' }` paths.
     *
     * A clone or network error still throws, exactly as it always has.
     */
    status: 'installed' | 'skipped' | 'failed';
    /**
     * Why a `failed` / `skipped` run stopped — one code per return site, and
     * exactly the five codes the panel's former `installGitCore` answered with
     * (the CLI ignores this and keeps its own stderr wording). Never set on
     * `installed`.
     *
     * It lives on the result because the status alone cannot express it: the
     * panel maps each code to its own `error` payload, and collapsing them into
     * one would silently change what the panel reports.
     */
    code?: GitInstallFailCode;
    /** Registered entry; only present when `status === 'installed'`. */
    entry?: SkillEntry;
    /** Link names created in the official skills root, in creation order. */
    links: string[];
    /** Frontmatter fields the install-time normalization rewrote. */
    normalized: number;
    clone: CloneResult;
}
/**
 * The five stop reasons of a non-`installed` run (§10.4 dialect). Each is a
 * former `installGitCore` 400 in `src/http/routes.ts`; `dsh-plugin-repo` and
 * `aborted` are unreachable behind the panel's OpsIO (`jobIO.confirm` always
 * raises `NeedsConfirm` instead of answering "no") but stay in the union so the
 * route can keep its documented mapping.
 */
export type GitInstallFailCode = 'subdir-not-found' | 'dsh-plugin-repo' | 'no-skill-md' | 'no-installable-skills' | 'aborted';
/**
 * The filesystem-mutating phase of `add` — clone → classify → normalize →
 * register → link — run under the per-skill cross-process lock (§7.3 layer 3).
 * Body unchanged from the former inline flow; the read-only preflight (subdir
 * validation, default-branch detect, re-registration and collision checks)
 * stays with the caller.
 */
export declare function installFromGit(params: GitInstallParams): Promise<GitInstallResult>;
/** Repos with > this many skills trigger the "install all?" guard (unless --subdir/--yes). */
export declare const LARGE_COLLECTION_THRESHOLD = 20;
//# sourceMappingURL=install.d.ts.map
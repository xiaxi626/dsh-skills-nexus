import type { CloneResult, GitSpec } from './git.js';
import type { OpsIO } from './ops-io.js';
import type { SkillEntry } from './types.js';
/**
 * The one filesystem-mutating install phase for a git source
 * (`clone → classify → normalize → register → link`).
 *
 * §10.1 of `docs/source-and-migration-design.md` requires the new channels to
 * share one core: `import` (installing an entry from a recorded git source)
 * and `adopt` must reuse the very implementation the CLI already runs, the way
 * `src/switch-version.ts` and `src/remove.ts` already do — a second copy of
 * this sequence would drift from the first, and the two front ends would
 * disagree about what "installed" means. This module is that one
 * implementation, so a future `src/import.ts` installs a git source without
 * carrying a third copy of the logic.
 *
 * `src/http/routes.ts` still holds a mirror of this phase (the panel half
 * predates the extraction), and unifying it is deliberately out of scope here.
 *
 * The caller keeps the read-only preflight and the locking: `add` validates
 * `--subdir`, detects the default branch and refuses re-registration /
 * collisions before anything is created, then holds the per-skill
 * cross-process lock around this call.
 *
 * This module is not presentation-free yet: the install-time spinner comes
 * from `cli/progress.js` (`withSpinner`), which the caller cannot inject —
 * swapping it for `io.progress` would change the CLI's output, so it is kept
 * exactly as the inline flow had it.
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
    /** Registered entry; only present when `status === 'installed'`. */
    entry?: SkillEntry;
    /** Link names created in the official skills root, in creation order. */
    links: string[];
    /** Frontmatter fields the install-time normalization rewrote. */
    normalized: number;
    clone: CloneResult;
}
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
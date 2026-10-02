import type { OpsIO } from './ops-io.js';
/**
 * `adopt` — channel D of the source & migration design
 * (`docs/source-and-migration-design.md` §6): give an entry that has no git
 * source an identity, so it stops being frozen. A snapshot that came off a
 * package, a directory somebody handed over, a legacy zip install — all of them
 * become ordinary updatable entries, indistinguishable from one `add` created.
 *
 * Seven steps, isomorphic with `switch-version` (§6): clone the new source into
 * a staging directory under `repos/` → compare what it yields with what the
 * entry exposes today → back the current directory up as
 * `repos/<path>.pre-adopt-<ts>` → move the stage into place → rebuild the link
 * set → write `url/gitUrl/ref/commit/subdir` into the manifest → prune the
 * backup, or report where it is.
 *
 * §10.1 requires CLI and panel to call one implementation, so everything lives
 * here and `src/cli/commands/adopt.ts` is a thin shell over it.
 *
 * Three deltas from the §6 sketch, each of them keeping an existing invariant
 * rather than adding a feature:
 *
 *   - **the new clone is normalized before it lands.** The checkout holds the
 *     raw upstream files; a frontmatter name the official provider rejects
 *     would make the entry look linked and be silently skipped. This is the
 *     same install-time convention as `add` and `switch-version` step 5.
 *   - **link-name collisions are refused before anything is replaced.** `add`
 *     preflights the same condition (`hasCollision`); a hand-placed directory
 *     at a name the new source wants is not something to discover halfway
 *     through a link rebuild.
 *   - **`ownership: 'external'` entries are refused outright.** They only link
 *     a directory the user owns, and §2.1's hard invariant (`external ⇒
 *     gitUrl === ''`) exists so nexus never touches that directory. Adopting
 *     one would have to replace it.
 *
 * Everything else follows §6 literally: the entry keeps its name and its
 * `path`, no URL is ever guessed (the caller must pass `--url`), and a failure
 * at any step restores "directory, links, manifest" to exactly what they were
 * — best-effort, swallowing the rollback's own errors the way
 * `rollbackSwitch` does, because the original error is what the caller must
 * see.
 */
/** Why an adopt could not run, or could not complete (§10.4 dialect). */
export type AdoptErrorCode = 'skill-not-found' | 'already-has-source' | 'external-entry' | 'invalid-url' | 'invalid-subdir' | 'clone-failed' | 'not-a-directory' | 'no-skill-found' | 'skill-mismatch' | 'collision' | 'adopt-failed';
/** An adopt was refused, failed, or failed and was rolled back. */
export declare class AdoptError extends Error {
    /** Stable machine-readable code. */
    readonly code: AdoptErrorCode;
    constructor(code: AdoptErrorCode, message: string);
}
export interface AdoptOptions {
    /** Registered entry to adopt. Never renamed by this operation. */
    name: string;
    /** Where the entry really comes from — required, never guessed. */
    url: string;
    /** Branch / tag / commit; absent = the remote's default branch. */
    ref?: string;
    /** Repo-relative skill root; absent = the entry's recorded `subdir`. */
    subdir?: string;
    /** Adopt a source that yields different skills; also re-sources a git entry. */
    force?: boolean;
    /** Delete the pre-adopt backup on success instead of keeping it. */
    prune?: boolean;
    io: OpsIO;
}
export interface AdoptResult {
    name: string;
    /** Directory name under <repos>/ — the entry's `path`, never changed here. */
    path: string;
    /** The spec as the caller gave it; recorded verbatim as the entry's `url`. */
    url: string;
    /** The resolved clone URL. */
    gitUrl: string;
    /** The ref that was cloned. */
    ref: string;
    /** Commit of the fresh clone. */
    commit: string;
    /** Recorded skill root, when the entry has one. */
    subdir?: string;
    /** Link names the new source yields, in discovery order. */
    skills: string[];
    /** Link names actually created — empty when the entry stays disabled. */
    links: string[];
    /** True when the entry was exposed through at least one link before. */
    wasEnabled: boolean;
    /** Frontmatter fields the install-time normalization rewrote. */
    normalized: number;
    /** Where the previous directory was kept, when it was kept. */
    backup?: string;
    /** True when a backup existed and `--prune` removed it. */
    pruned: boolean;
}
/**
 * Re-source `name` from `url` and rebuild everything derived from it.
 *
 * The entry must currently have no git source; `--force` both lifts that
 * precondition and bypasses the discovery-mismatch guard (step 2), which is
 * what makes "adopt the other repository instead" a deliberate act rather than
 * a silent catalog change.
 */
export declare function adoptSkill(options: AdoptOptions): Promise<AdoptResult>;
//# sourceMappingURL=adopt.d.ts.map
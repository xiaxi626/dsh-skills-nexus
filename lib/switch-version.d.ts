import type { OpsIO } from './ops-io.js';
/**
 * `switch-version` — move an entry's clone to another branch / tag / commit
 * and rebuild everything derived from the checkout (§8.2, seven steps +
 * rollback):
 *
 *   1. record the old link set and the old checkout (what a rollback restores)
 *   2. fetch — a `--depth 1` clone holds no other refs/tags locally
 *   3. resolve + verify the target; a missing ref leaves the clone untouched
 *   4. discard drift, then check out the target
 *   5. re-normalize frontmatter (the checkout restored raw upstream files)
 *   6. drop the old links, create the new set (names may have changed)
 *   7. record the new commit + ref (`refType` is a transient hint, never stored)
 *
 * Design deviation (§6.3 lists `src/git.ts` for `switchVersion`): the
 * orchestration lives in this module so `git.ts` stays a pure git-primitive
 * layer — the steps above also touch the manifest, symlinks and frontmatter,
 * which `git.ts` must not depend on.
 */
/** The manifest has no entry under this name. */
export declare class SkillNotFoundError extends Error {
    readonly skillName: string;
    constructor(skillName: string);
}
/**
 * The requested ref could not be resolved — neither freshly fetched nor
 * already present locally. Thrown before any state change (§8.2 step 3).
 */
export declare class RefNotFoundError extends Error {
    readonly ref: string;
    constructor(ref: string);
}
/** Entries without a git source have no history to switch (→ 400 not-a-git-clone). */
export declare class NotAGitCloneError extends Error {
    readonly skillName: string;
    constructor(skillName: string);
}
/** Outcome of a successful {@link switchVersion}. */
export interface SwitchVersionResult {
    name: string;
    /** The ref that was switched to. */
    ref: string;
    /** Commit before the switch. */
    before: string;
    /** Commit after the switch (the resolved target commit). */
    after: string;
    /** How the clone ended up: aligned local branch vs detached pin. */
    kind: 'branch' | 'pin';
    /** True when local drift was discarded before the checkout. */
    wasDirty: boolean;
    /** Link names after the rebuild (empty when the entry is disabled). */
    links: string[];
}
/**
 * Switch the entry's clone to `ref` and rebuild the derived state.
 *
 * `refType` is the caller's hint (branch vs tag/commit, §8.2): the checkout
 * style actually follows what the fetch landed; the hint only orders the
 * offline fallback when nothing could be fetched. It is never persisted.
 */
export declare function switchVersion(name: string, ref: string, refType: 'branch' | 'tag' | 'commit' | undefined, io: OpsIO): Promise<SwitchVersionResult>;
//# sourceMappingURL=switch-version.d.ts.map
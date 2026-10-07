/** A successful read-only comparison of one managed entry. */
export interface DiffResult {
    name: string;
    fromCommit: string;
    toCommit: string;
    target: string;
    output: string;
    stat: boolean;
}
export declare class DiffSkillNotFoundError extends Error {
    readonly skillName: string;
    constructor(skillName: string);
}
export declare class DiffNotAGitCloneError extends Error {
    readonly skillName: string;
    constructor(skillName: string);
}
export declare class DiffTargetRequiredError extends Error {
    readonly skillName: string;
    constructor(skillName: string, reason: 'locked' | 'detached');
}
/**
 * Compare one managed checkout with a freshly fetched remote ref without
 * checking it out or rewriting the manifest/link state.
 *
 * Omitting `target` is intentionally narrower than `entry.ref`: only an
 * actually attached branch may supply the remote branch name, and an explicit
 * package lock always requires the caller to name a target. This keeps
 * manifest labels from being mistaken for live Git state.
 */
export declare function diffEntry(name: string, target?: string, stat?: boolean): Promise<DiffResult>;
//# sourceMappingURL=diff.d.ts.map
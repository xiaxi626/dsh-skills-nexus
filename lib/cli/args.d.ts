/** Tiny argv parser — keeps the CLI dependency-free. */
export interface AddOptions {
    /**
     * Repo specs in the order given. `add` accepts one or more; the per-repo
     * options below are rejected when more than one spec is present (see add.ts),
     * because each is inherently one-to-one with a single repo.
     */
    specs: string[];
    name?: string;
    ref?: string;
    /** Path of the skill root inside the cloned repo, e.g. `skills/foo`. */
    subdir?: string;
    /** Automatically accept "manage this wrapped repo via nexus" prompts. */
    yes?: boolean;
}
export declare function parseAddArgs(argv: string[]): AddOptions;
/** First positional argument, or undefined. */
export declare function positional(argv: string[]): string | undefined;
export interface RemoveOptions {
    /**
     * Name-or-pattern tokens, in order. A token containing `*` or `?` is a glob
     * matched against registered skill names (see remove.ts); any other token is
     * an exact name.
     */
    patterns: string[];
    /** Skip the "remove N skills matching <pattern>?" confirmation guard. */
    yes: boolean;
}
/**
 * Parse `remove` args: one or more names/globs plus an optional `--yes`.
 *
 * Boolean flags reject an inline value for the same reason as parseAddArgs —
 * silently dropping it would turn `--yes=false` into yes=true and bypass the
 * multi-match deletion guard (remove.ts).
 */
export declare function parseRemoveArgs(argv: string[]): RemoveOptions;
//# sourceMappingURL=args.d.ts.map
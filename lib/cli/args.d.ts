/** Tiny argv parser — keeps the CLI dependency-free. */
export interface AddOptions {
    spec: string;
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
//# sourceMappingURL=args.d.ts.map
/** Tiny argv parser — keeps the CLI dependency-free. */
export interface AddOptions {
    spec: string;
    name?: string;
    ref?: string;
}
export declare function parseAddArgs(argv: string[]): AddOptions;
/** First positional argument, or undefined. */
export declare function positional(argv: string[]): string | undefined;
//# sourceMappingURL=args.d.ts.map
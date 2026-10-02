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
export interface ListOptions {
    /** Print only skill names, one per line — the machine path (shell completion). */
    names: boolean;
}
/**
 * Parse `list` args. `list` has no positional form and exactly one boolean flag.
 *
 * `--names` rejects an inline value for the same reason as `--yes` above:
 * `--names=false` silently becoming `names=true` would hand a scripted caller
 * the names-only stream when it asked for the human table. Unlike `add` — which
 * ignores unknown flags because it has extra options to be tolerant about —
 * unknown arguments here are usage errors: a typo like `--name` would otherwise
 * silently print the table to a script that expects one name per line.
 */
export declare function parseListArgs(argv: string[]): ListOptions;
export interface ExportOptions {
    /** Entry names to package, in the order given. */
    names: string[];
    /** Package every managed entry (disabled ones included). */
    all: boolean;
    /** Output path; absent means the command's default (`<name>.zip` / dated). */
    out?: string;
}
/**
 * Parse `export` args: entry names or `--all`, plus an optional `--out`.
 *
 * Unlike `add` (which has per-repo options and therefore tolerates unknown
 * flags) this rejects anything it does not know: `export` writes a file whose
 * name is derived from what it was given, so a typo silently falling back to
 * "export everything" would be worse than a usage error. `--all` and explicit
 * names are mutually exclusive for the same reason — asking for one entry and
 * silently getting the whole manifest is not a recoverable surprise.
 *
 * `--out` is the only value-taking option here; `-o` is accepted as an alias
 * and is deliberately absent from `--help`'s option list (the shell templates
 * advertise long options only, matching `-y` for `--yes`).
 */
export declare function parseExportArgs(argv: string[]): ExportOptions;
//# sourceMappingURL=args.d.ts.map
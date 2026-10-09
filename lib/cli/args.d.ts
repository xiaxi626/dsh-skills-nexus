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
    /** Emit the version-1 machine report on stdout instead of human text. */
    json: boolean;
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
    /** Emit the version-1 machine report on stdout instead of human text. */
    json: boolean;
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
    /** Emit the version-1 machine report on stdout instead of the human table. */
    json: boolean;
    /** Case-insensitive substring filter over name / url / subdir. */
    filter?: string;
}
/**
 * Parse `list` args. `list` has no positional form and two boolean flags,
 * which are mutually exclusive: `--names` is the newline stream shell
 * completion splits on and `--json` is the structured document — asking for
 * both has no single sensible answer, so it is a usage error rather than a
 * silent precedence rule. `--filter <query>` is an optional value-taking
 * flag that narrows the output to entries whose name, URL or subdir contain
 * the query (case-insensitive).
 *
 * Both boolean flags reject an inline value for the same reason as `--yes`
 * above: `--names=false` silently becoming `names=true` would hand a scripted
 * caller the names-only stream when it asked for the human table. Unknown
 * arguments here are usage errors: a typo like `--name` would otherwise
 * silently print the table to a script that expects one name per line.
 */
export declare function parseListArgs(argv: string[]): ListOptions;
export interface UpdateOptions {
    /** Entry name to refresh, or undefined for every enabled entry. */
    target?: string;
    /** Emit the version-1 machine report on stdout instead of human text. */
    json: boolean;
}
/**
 * Parse `update` args: an optional single positional plus `--json`.
 *
 * Strict like `list`, not tolerant like `add`: `update` used to read its target
 * with `positional()` and ignore every flag, so `update --json` would have been
 * silently discarded — the exact failure mode this parser exists to prevent.
 * A second positional is rejected for the same reason: there is one target or
 * "everything enabled", and no batch form.
 */
export declare function parseUpdateArgs(argv: string[]): UpdateOptions;
export interface ToggleOptions {
    /** Entry names to enable/disable, in the order given. */
    names: string[];
    /** Emit the version-1 machine report on stdout instead of human text. */
    json: boolean;
}
/**
 * Parse `enable`/`disable` args: one or more names plus `--json`.
 *
 * Batch like `remove` (gap-closure A3) — `positional()` already existed and
 * `remove` already accepted several tokens, so the single-name form was the
 * asymmetry. `command` is only used for the usage wording, so the two commands
 * that share this parser still name themselves in their errors.
 */
export declare function parseToggleArgs(argv: string[], command: 'enable' | 'disable'): ToggleOptions;
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
export interface ImportOptions {
    /** Package path — a `.zip` archive or a directory tree. */
    source: string;
    /** Report what would happen; touch nothing. */
    dryRun: boolean;
    /** Skip the remote probe entirely (offline: no waiting, no verdict). */
    noNetCheck: boolean;
    /** Land everything as a snapshot, even when the label records a remote. */
    noRemote: boolean;
    /** Restore each labelled entry at its exact recorded commit. */
    locked: boolean;
    /** One entry per skill instead of one per candidate root. */
    each: boolean;
    /** Replace an existing entry of the same name. */
    force: boolean;
    /** Entry name override (single-entry packages). */
    name?: string;
    /** Package-relative root, or a labelled entry's name. */
    subdir?: string;
    /** Skip the large-collection confirmation during a git install. */
    yes: boolean;
}
/**
 * Parse `import` args: exactly one package path plus its modifiers.
 *
 * Strict like `export` and `list`, not tolerant like `add`: every flag here
 * changes what lands on disk, and a typo that turned `--dry-run` into a real
 * import (or `--no-remote` into a clone) is not something the user can undo by
 * re-running. A second positional is rejected for the same reason — a package
 * path with a stray word after it is a mistake, not a batch.
 */
export declare function parseImportArgs(argv: string[]): ImportOptions;
export interface AdoptOptions {
    /** Registered entry to adopt. */
    name: string;
    /** Where the entry really comes from — required (`adopt` never guesses a URL). */
    url: string;
    /** Branch / tag / commit of the new source. */
    ref?: string;
    /** Repo-relative skill root inside the new clone. */
    subdir?: string;
    /** Adopt a source that yields different skills; also re-sources a git entry. */
    force: boolean;
    /** Delete the pre-adopt backup on success. */
    prune: boolean;
}
/**
 * Parse `adopt` args: exactly one entry name plus the source to attach.
 *
 * Strict like `import`/`export`/`list`, not tolerant like `add`: this command
 * replaces a directory the user may still need, and every flag here changes
 * what that replacement is. A typo that turned `--prune` into "keep" (or
 * `--subdir` into "the clone root") would be discovered only after the old
 * directory had been moved aside, so unknown arguments are usage errors.
 *
 * `--url` is required rather than inferred: §6 forbids URL guessing outright,
 * and the one thing this command must never do is adopt the wrong repository.
 * A second positional is rejected for the same reason a missing one is — the
 * name identifies which entry to re-source, and there is no batch form.
 */
export declare function parseAdoptArgs(argv: string[]): AdoptOptions;
//# sourceMappingURL=args.d.ts.map
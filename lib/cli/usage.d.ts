/**
 * The CLI's `--help` text, kept out of the dispatcher (`index.ts`) for one
 * concrete reason: `index.ts` is an executable module — importing it runs
 * `main(process.argv.slice(2))` — so nothing in it can be imported by a test.
 *
 * The help text is measured by a test: `test/completions.test.ts` asserts that
 * every flag this text documents is offered by all four shell completion
 * templates, which is the guard that keeps `completions --shell <name>` from
 * advertising a flag the CLI does not accept (or missing one it does).
 *
 * A1 moved the write itself from `process.stdout.write` to `io.emit` — the last
 * CLI output that bypassed the `OpsIO` seam. That refactor is exactly what a
 * source-scraping guard turns into a false failure: the old test reached into
 * `printHelp`'s `write(\`…\`)` call with a regexp, so it broke on a change that
 * produced byte-identical output. Hoisting the text into a named export and the
 * printer into a callable that takes an `OpsIO` makes the guard depend on the
 * text, not on how the text is printed.
 */
import type { OpsIO } from '../ops-io.js';
/**
 * Every word `main()` routes, aliases included — the list the four shell
 * completion templates have to offer, in the sorted order they emit.
 *
 * It lives here rather than being scraped out of `index.ts` at test time
 * because `index.ts` is an executable module and a compiled test run has no
 * `.ts` source to read. `test/completions.test.ts` still cross-checks this
 * constant against the dispatcher's own `case` labels whenever the sources are
 * reachable, so a new subcommand cannot be added to the router and forgotten
 * here; and the help text above is asserted to document every one of them.
 */
export declare const ROUTED_SUBCOMMANDS: readonly ["add", "adopt", "completions", "disable", "diff", "doctor", "enable", "export", "help", "import", "link", "list", "ls", "pull", "purge", "remove", "rm", "rollback", "switch-version", "update"];
/** The full help text, as one pure constant. */
export declare const HELP_TEXT: string;
/**
 * Print the help through the caller's `OpsIO`. The bytes are identical to the
 * former direct `process.stdout.write(HELP_TEXT)`: `HELP_TEXT` already ends in
 * a newline, and `cliIO.emit` appends one only when it is missing.
 */
export declare function printHelp(io?: OpsIO): void;
//# sourceMappingURL=usage.d.ts.map
/**
 * OpsIO — the single seam between the two front ends (CLI today, the HTTP
 * plugin half in Phase 2) and the shared command core.
 *
 * Commands perform every interactive side effect (confirmation, progress,
 * output) through this interface instead of touching `process.stdout`,
 * `readline` or the spinner directly, so the two front ends cannot drift
 * apart: the CLI passes `cliIO` (below), the HTTP layer will pass an
 * `httpIO` that turns confirmations into `confirm: true` request flags and
 * progress into pollable job records.
 */
export interface OpsIO {
    /**
     * Ask a destructive-operation question. CLI = `prompt.confirm` (returns
     * `defaultValue` when stdin is not a TTY); HTTP = requires `confirm: true`
     * in the request and throws `NeedsConfirm` otherwise (mapped to a 409 that
     * carries the question text).
     */
    confirm(question: string, defaultValue: boolean): Promise<boolean>;
    /**
     * Report a stage of a long-running operation. CLI = one stderr line
     * (silent when stderr is not a TTY, matching the spinner's no-op
     * behaviour); HTTP = written to the job record polled via the jobs route.
     */
    progress(stage: string, detail?: string): void;
    /**
     * Emit one line of batch output. CLI = stdout summary; HTTP = collected
     * into the response data. `line` may or may not end in `\n` — the CLI
     * implementation appends one only when it is missing.
     */
    emit(line: string): void;
    /**
     * Whether an interactive terminal is attached. CLI = `process.stdin.isTTY`;
     * HTTP = `false`.
     */
    readonly interactive: boolean;
    /**
     * Wrap a slow step (a clone, a fetch) in a progress indicator, resolving
     * whatever `fn` resolves.
     *
     * Optional on purpose: progress is cosmetic and never load-bearing, so a
     * front end that has no indicator simply runs `fn` instead of implementing a
     * no-op. That is also why the shared cores call it as
     * `const spin = io.spin ?? runInline` rather than through a required member —
     * there are nine literal `OpsIO` stand-ins across `src/` and `test/`, and a
     * required member would have to be added to every one of them for no
     * behavioural gain (the cost of forgetting it is a silently progress-less
     * front end, which is the same thing a no-op would have produced).
     *
     * CLI = `cli/progress.withSpinner`, the very function object the install core
     * used to import directly, so a TTY renders the identical `\r`-animated
     * spinner and a non-TTY stays silent. HTTP = run `fn` as it is: a polled job
     * record is not a terminal and must never receive `\r`/ANSI.
     */
    spin?<T>(message: string, fn: () => Promise<T>): Promise<T>;
}
/**
 * Thrown by the HTTP-side `OpsIO.confirm` when a request that needs
 * confirmation did not carry `confirm: true`. Lives next to the interface so
 * both halves throw and catch the same class.
 */
export declare class NeedsConfirm extends Error {
    /** The question the caller must re-answer with `confirm: true`. */
    readonly question: string;
    /** The answer the prompt defaults to (typically `false`). */
    readonly defaultValue: boolean;
    constructor(question: string, defaultValue: boolean);
}
/**
 * The CLI implementation of `OpsIO`, used as the default `io` argument of
 * every command function so existing call sites, tests and output stay
 * unchanged.
 *
 * - `confirm` delegates to the one shared `prompt.confirm` implementation
 *   (non-TTY stdin resolves to `defaultValue` without blocking);
 * - `progress` writes one line to stderr, gated on `stderr.isTTY` — off a
 *   TTY it is a silent no-op, exactly like the spinner, so ANSI/`\r` never
 *   pollutes captured output;
 * - `emit` writes to stdout and guarantees the trailing `\n`; strings that
 *   already carry one (the ported `process.stdout.write` call sites) pass
 *   through byte-for-byte;
 * - `spin` is `withSpinner` itself — not a wrapper around it — so the shared
 *   cores animate exactly what they animated before this seam existed;
 * - `interactive` is read live from stdin so command logic observes the same
 *   TTY-ness that `prompt.confirm` will.
 */
export declare const cliIO: OpsIO;
//# sourceMappingURL=ops-io.d.ts.map
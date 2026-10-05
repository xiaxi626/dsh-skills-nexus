/**
 * The `--json` half of the CLI's output seam (P0 §3.1/§5).
 *
 * `jsonIO` is the third `OpsIO` implementation, beside `cliIO` (terminal) and
 * `httpIO`/`quietIO` (the panel). Its contract is "stdout stays pure": a command
 * running under `--json` must write nothing to stdout except the one
 * `JSON.stringify(report, null, 2) + '\n'` the report emitter produces, so
 * every human line the shared code would have printed has to go somewhere
 * else —
 *
 *   - `emit`   → nowhere (the structured report *is* the output);
 *   - `error`  → the real stderr, because diagnostics are explicitly *not*
 *                part of the stdout contract (P0 §2.2) and a lost diagnostic
 *                is worse than a mixed stream;
 *   - `progress` → nowhere (it is cosmetic and TTY-gated anyway);
 *   - `spin`   → run inline: a spinner animates a terminal that is not
 *                watching a machine-readable stream;
 *   - `confirm` → resolve `defaultValue` without blocking. `interactive` is
 *                `false`, so the guards that refuse to act without a terminal
 *                (the broad-glob removal, the wrapped-repo and large-collection
 *                install prompts) keep refusing exactly as they do under a
 *                pipe — the difference is only that the JSON run reports the
 *                refusal in its `results[]` instead of a bare stderr line.
 *
 * `jsonIO(io)` therefore means "machine mode, keep the diagnostics": it wraps
 * whatever `error` channel the caller already had, so the CLI keeps stderr and
 * a test can capture both streams from one object.
 */
/**
 * A silent `OpsIO` for the `--json` paths: no stdout, no progress, no prompt.
 * `error` delegates to `fallback`'s channel when one is given (the CLI's own
 * `cliIO`), so diagnostics still reach stderr; without it they are dropped.
 */
export function jsonIO(fallback) {
    return {
        interactive: false,
        confirm(_question, defaultValue) {
            return Promise.resolve(defaultValue);
        },
        progress() {
            // machine mode — a stage line has no place on a JSON stream
        },
        emit() {
            // machine mode — the structured report is the only stdout writer
        },
        error(line) {
            fallback?.error(line);
        },
        spin(_message, fn) {
            // machine mode — no terminal is watching; run the step inline
            return fn();
        },
    };
}
/**
 * Write one report as the machine contract (P0 §2.1): 2-space indentation and
 * a trailing newline, so `... | jq` and a plain `read` both behave.
 *
 * The report's own `version` is carried in the object, not added here — each
 * report type declares `version: 1` literally, which is what makes a breaking
 * change a compile error rather than a forgotten bump.
 */
export function emitJson(io, report) {
    io.emit(`${JSON.stringify(report, null, 2)}\n`);
}
/**
 * The unexpected-fatal shape of P0 §4.6: `{ version: 1, error: { message } }`
 * on **stderr**, exit 1. Used by the dispatcher's top-level catch, and by a
 * usage error that arrived under `--json` (exit 2 keeps the usage-error code
 * while the *shape* stays machine-readable).
 */
export function fatalJsonError(io, message) {
    const report = { version: 1, error: { message } };
    io.error(JSON.stringify(report, null, 2));
}
//# sourceMappingURL=json-io.js.map
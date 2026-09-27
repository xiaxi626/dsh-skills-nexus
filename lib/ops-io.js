import { confirm as promptConfirm } from './cli/prompt.js';
/**
 * Thrown by the HTTP-side `OpsIO.confirm` when a request that needs
 * confirmation did not carry `confirm: true`. Lives next to the interface so
 * both halves throw and catch the same class.
 */
export class NeedsConfirm extends Error {
    /** The question the caller must re-answer with `confirm: true`. */
    question;
    /** The answer the prompt defaults to (typically `false`). */
    defaultValue;
    constructor(question, defaultValue) {
        super(question);
        this.name = 'NeedsConfirm';
        this.question = question;
        this.defaultValue = defaultValue;
    }
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
 * - `interactive` is read live from stdin so command logic observes the same
 *   TTY-ness that `prompt.confirm` will.
 */
export const cliIO = {
    confirm: promptConfirm,
    progress(stage, detail) {
        if (!process.stderr.isTTY)
            return;
        process.stderr.write(detail ? `${stage}: ${detail}\n` : `${stage}\n`);
    },
    emit(line) {
        process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
    },
    get interactive() {
        return process.stdin.isTTY === true;
    },
};
//# sourceMappingURL=ops-io.js.map
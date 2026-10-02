/**
 * The `import` decision verdict — the one line that says how an entry would
 * land, and the four-state rule of §10.2 behind it.
 *
 * It lives in its own module because **both faces render it**: the CLI's
 * `--dry-run` report (`src/cli/commands/import.ts`) and the panel's import
 * preview. The design requires one wording for the four verdicts
 * (`will clone from …` / `… unreachable` / `… check timed out` /
 * `source unknown`), so the panel must not re-invent its own phrasing.
 *
 * Deliberately dependency-free: `src/import.ts` is the core the CLI runs and
 * pulls in `node:fs` / `node:child_process` / the zip codec, none of which may
 * reach the browser bundle that also renders this text.
 */
/** One verdict of a plan (§10.2): either the remote answers, or it does not. */
export type ImportDecision = {
    kind: 'git';
    url: string;
    ref: string;
} | {
    kind: 'snapshot';
    reason: SnapshotReason;
};
/**
 * `unreachable` means the remote answered with a failure; `timeout` means it did
 * not answer in time. The two must never be conflated, or a slow network looks
 * like a deleted repository (§10.2). `not-checked` is `--no-net-check`.
 */
export type SnapshotReason = 'no-source' | 'unreachable' | 'timeout' | 'no-remote' | 'not-checked';
/**
 * How one planned entry will land, in the wording of §10.2 — a label only, no
 * name, counts or conflict markers (those belong to the caller's line format).
 */
export interface DecisionCarrier {
    decision: ImportDecision;
}
export declare function describeDecision(entry: DecisionCarrier): string;
//# sourceMappingURL=import-decision.d.ts.map
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

/** One verdict of a plan (§10.2): follow a ref, restore an exact commit, or use the payload. */
export type ImportDecision =
  | { kind: 'git-ref'; url: string; ref: string }
  | { kind: 'git-locked'; url: string; ref: string; commit: string }
  | { kind: 'snapshot'; reason: SnapshotReason }

/**
 * `unreachable` means the remote answered with a failure; `timeout` means it did
 * not answer in time. The two must never be conflated, or a slow network looks
 * like a deleted repository (§10.2). `not-checked` is `--no-net-check`.
 */
export type SnapshotReason =
  | 'no-source'
  | 'unreachable'
  | 'timeout'
  | 'no-remote'
  | 'not-checked'
  | 'commit-unavailable'

/**
 * How one planned entry will land, in the wording of §10.2 — a label only, no
 * name, counts or conflict markers (those belong to the caller's line format).
 */
export interface DecisionCarrier {
  decision: ImportDecision
}

export function describeDecision(entry: DecisionCarrier): string {
  if (entry.decision.kind === 'git-ref') {
    return `will clone from ${entry.decision.url} (${entry.decision.ref})`
  }
  if (entry.decision.kind === 'git-locked') {
    return `will clone locked commit ${entry.decision.commit} from ${entry.decision.url} ` +
      `(source ref: ${entry.decision.ref}; snapshot fallback only if that commit is unavailable)`
  }
  switch (entry.decision.reason) {
    case 'unreachable':
      return 'will import as snapshot (remote unreachable)'
    case 'timeout':
      return 'will import as snapshot (remote check timed out)'
    case 'no-remote':
      return 'will import as snapshot (--no-remote)'
    case 'not-checked':
      return 'will import as snapshot (remote not checked)'
    case 'commit-unavailable':
      return 'will import as snapshot (locked commit unavailable)'
    default:
      return 'will import as snapshot (source unknown)'
  }
}

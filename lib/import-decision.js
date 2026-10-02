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
export function describeDecision(entry) {
    if (entry.decision.kind === 'git') {
        return `will clone from ${entry.decision.url} (${entry.decision.ref})`;
    }
    switch (entry.decision.reason) {
        case 'unreachable':
            return 'will import as snapshot (remote unreachable)';
        case 'timeout':
            return 'will import as snapshot (remote check timed out)';
        case 'no-remote':
            return 'will import as snapshot (--no-remote)';
        case 'not-checked':
            return 'will import as snapshot (remote not checked)';
        default:
            return 'will import as snapshot (source unknown)';
    }
}
//# sourceMappingURL=import-decision.js.map
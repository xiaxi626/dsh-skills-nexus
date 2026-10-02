import type { OpsIO } from '../../ops-io.js';
/**
 * `import <package> [--dry-run] [--subdir <path>] [--each] [--force] ...` —
 * rebuild entries from a package (channel C of the source & migration design,
 * §4.2/§10.1/§10.3).
 *
 * Thin wrapper over `src/import.ts`: parse argv, print the plan for `--dry-run`,
 * print a summary for a real run, map failures to exit codes. Which entries end
 * up as clones and which as snapshots is decided entirely by the core, so the
 * plugin half will reuse it unchanged.
 *
 * The dry run is the contract of §10.2 — every entry is reported with one of the
 * four verdicts (clone / unreachable / timed out / source unknown) so a user
 * holding an unknown zip can tell whether it is worth importing before letting
 * anything touch their skills root.
 *
 * Exit codes: 0 = imported (or planned), 1 = failed, 2 = usage error.
 */
export declare function importCommand(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=import.d.ts.map
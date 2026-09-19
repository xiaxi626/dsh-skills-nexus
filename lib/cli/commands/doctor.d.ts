/**
 * `doctor [--json] [--updates] [--quiet]` — a proactive, read-only full checkup
 * of nexus state. Reports problems and how to fix them; changes nothing.
 *
 * Default is fully local and instant. `--updates` additionally compares each
 * branch-pinned entry against its remote (network). `--json` emits a stable
 * machine-readable contract (version 1) for external tools; `--quiet` suppresses
 * output unless there is at least one error (CI convenience).
 *
 * Exit codes: 0 = no error, 1 = at least one error, 2 = usage error.
 */
export type CheckStatus = 'ok' | 'warn' | 'error' | 'update-available';
export type Severity = 'error' | 'warn' | 'info';
export interface DoctorIssue {
    severity: Severity;
    code: string;
    name: string;
    fix?: string;
    detail?: string;
}
export interface DoctorCheck {
    id: string;
    status: CheckStatus;
    detail?: string;
    issues: DoctorIssue[];
}
export interface DoctorReport {
    version: 1;
    checks: DoctorCheck[];
    summary: {
        errors: number;
        warnings: number;
        updates: number;
    };
}
export interface DoctorOptions {
    json: boolean;
    updates: boolean;
    quiet: boolean;
}
/**
 * Parse `doctor` args. All three flags are boolean and reject an inline value
 * (same rule as `--yes` in args.ts): silently dropping `--json=false` would
 * turn it into `--json=true`. Positional arguments and unknown options are
 * usage errors — `doctor` always checks everything.
 */
export declare function parseDoctorArgs(argv: string[]): DoctorOptions;
/**
 * Run every check and assemble the report. `includeUpdates` adds the network
 * `updates` check (P2). Order matches the human-readable report.
 */
export declare function runChecks(includeUpdates: boolean): Promise<DoctorReport>;
/** Render the report as the aligned, human-readable report (stdout). */
export declare function formatHuman(report: DoctorReport): string;
export declare function doctor(argv: string[]): Promise<number>;
//# sourceMappingURL=doctor.d.ts.map
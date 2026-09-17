/**
 * Startup health check for nexus-managed symlinks.
 *
 * Called from the plugin's `apply()` on every DSH startup. Verifies that each
 * manifest entry's symlinks in the official skills root still point at valid
 * target directories. Purely filesystem-based — no git, no network.
 *
 * Design constraints:
 *   - Must never throw (crash DSH startup).
 *   - Must never block (fire-and-forget from apply()).
 *   - Disabled entries (no symlink) are normal and NOT reported.
 *   - Only broken/missing targets produce warnings.
 */
import type { SkillEntry } from './types.js';
export type EntryDiagnosis = 'ok' | 'disabled' | 'broken-link' | 'missing-target';
export interface HealthIssue {
    name: string;
    issue: 'broken-link' | 'missing-target';
}
/**
 * Diagnose a single manifest entry's symlink health.
 *
 * Scans `OFFICIAL_SKILLS_DIR` for symlinks whose resolved target falls inside
 * `repoDir(entry.path)`. Then verifies the target directory actually exists.
 *
 * Returns:
 *   - 'ok'             — at least one symlink points to a valid, existing directory
 *   - 'disabled'       — no symlink in the skills root points to this entry (normal)
 *   - 'broken-link'    — a symlink was found but readlink failed on it
 *   - 'missing-target' — a symlink was found and resolved, but the target directory does not exist
 */
export declare function diagnoseEntry(entry: SkillEntry): Promise<EntryDiagnosis>;
/**
 * Run health check on all manifest entries.
 * Returns only entries with real problems (broken-link / missing-target).
 * Disabled entries are normal and excluded from results.
 */
export declare function checkHealth(): Promise<HealthIssue[]>;
/** Format health issues into a human-readable warning string. */
export declare function formatWarning(issues: HealthIssue[]): string;
//# sourceMappingURL=health.d.ts.map
/**
 * Filesystem integrity checks for nexus-managed skills.
 *
 * Surfaced by the `doctor` CLI command — NOT from the plugin `apply()`, which
 * is an intentional no-op (a startup-time warning has no verified visible
 * output channel in DSH). Verifies that each manifest entry's symlinks in the
 * official skills root still point at valid target directories, and scans for
 * orphaned clones / links left behind when the manifest and the filesystem
 * drift apart. Purely filesystem-based — no git, no network.
 *
 * Design constraints:
 *   - Must never throw (it runs inside a read-only diagnostic command).
 *   - Disabled entries (no symlink) are normal and NOT reported.
 *   - Only missing targets produce issues.
 */
import type { SkillEntry } from './types.js';
export type EntryDiagnosis = 'ok' | 'disabled' | 'missing-target';
export interface HealthIssue {
    name: string;
    issue: 'missing-target';
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
 *   - 'missing-target' — a symlink was found and resolved, but the target directory does not exist
 *
 * A symlink whose readlink fails cannot be attributed to any entry (its target
 * is unreadable), so it is skipped here; the FS-side `findOrphanLinks()` scan
 * reports it instead as an `unreadable-link`.
 */
export declare function diagnoseEntry(entry: SkillEntry): Promise<EntryDiagnosis>;
/**
 * Run health check on all manifest entries.
 * Returns only entries with real problems (missing-target).
 * Disabled entries are normal and excluded from results.
 */
export declare function checkHealth(): Promise<HealthIssue[]>;
/** Format health issues into a human-readable warning string. */
export declare function formatWarning(issues: HealthIssue[]): string;
/**
 * Repo clone directories under `REPOS_DIR` that no manifest entry references —
 * leftover clones from an entry that was removed (or a manifest that was reset).
 * Returns repo-relative directory names (the top-level segment under `repos/`).
 */
export declare function findOrphanRepos(entries: SkillEntry[]): Promise<string[]>;
export type OrphanLinkCode = 'unreadable-link' | 'dangling-link' | 'orphan-link';
export interface OrphanLink {
    /** Symlink name in the official skills root. */
    name: string;
    code: OrphanLinkCode;
    /** Resolved target path (absent for `unreadable-link`). */
    target?: string;
}
/**
 * Symlinks in `OFFICIAL_SKILLS_DIR` that nexus can no longer account for.
 *
 * Only symlinks whose resolved target falls inside `REPOS_DIR` are considered —
 * anything pointing elsewhere is the user's own skill, not nexus's business.
 * Three cases:
 *   - `unreadable-link` — readlink failed; the target is unknown, so the link
 *     cannot be attributed to nexus. A caution only — never a delete hint.
 *   - `dangling-link`   — target resolves inside repos/ but no longer exists.
 *   - `orphan-link`     — target exists inside repos/ but no entry claims it.
 *
 * A link that a live entry *does* claim is skipped here — `diagnoseEntry`
 * already reports its health, so this avoids double-reporting the same problem.
 */
export declare function findOrphanLinks(entries: SkillEntry[]): Promise<OrphanLink[]>;
//# sourceMappingURL=health.d.ts.map
import type { OpsIO } from '../../ops-io.js';
/**
 * `update [name] [--json]` — bring a skill's clone to the latest state, or
 * verify a pinned one. Re-normalizes frontmatter and re-creates symlinks after
 * pull.
 *
 * Dispatch is decided by how the clone was pinned at `add` time:
 *   - branch pin (symbolic HEAD) → `git pull --ff-only`
 *   - tag / commit pin (detached) → verify pin, restore if drifted
 *
 * After update, frontmatter is re-normalized (git pull may have overwritten
 * previous fixes) and symlinks are re-created.
 *
 * A dirty worktree would block `git pull --ff-only` and pin restoration —
 * and install-time normalization rewrites `SKILL.md` in place, so managed
 * clones are usually dirty. Local changes are therefore discarded (with a
 * warning) before pulling / restoring; normalization is re-applied after.
 *
 * `--json` (P0 §4.3) reports one result per entry with its before/after commit.
 * Every entry is attempted independently, so a failure on one does not stop the
 * rest and the exit code is non-zero if any failed.
 */
export declare function update(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=update.d.ts.map
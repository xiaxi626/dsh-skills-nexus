import type { OpsIO } from '../../ops-io.js';
/**
 * `add` — clone one or more GitHub SKILL.md repos and expose each via symlinks
 * in the official DSH skills root.
 *
 * Each clone lands under <repos>/<path>/ and a symlink is created at
 * ~/.dsh/skills/<name>/ so the official filesystem provider discovers it
 * automatically. Multi-skill repos create one symlink per discovered skill.
 *
 * `--subdir <path>` installs a single subdirectory of the clone (collection
 * repos): the subdir is the skill root, the entry gets a `subdir` field, and
 * the clone directory is dedicated to that entry (independent-clone design).
 * Such a clone is sparse when Git and the remote allow it (partial clone +
 * cone-mode sparse-checkout), so unrelated directories are normally not
 * materialized; the command reports which mode was used.
 *
 * Multiple specs are installed left-to-right and independently: a failure on
 * one repo does not abort the rest, and the exit code is non-zero if any repo
 * failed (the same per-item model as `update`). The per-repo options
 * (--name/--ref/--subdir) are one-to-one with a single repo, so combining them
 * with multiple specs is rejected up front rather than silently misapplied.
 *
 * Before registering, each clone is *previewed* with the full skill rules, so
 * repos that yield zero installable skills are rejected.
 */
export declare function add(argv: string[], io?: OpsIO): Promise<number>;
/**
 * Re-exported from the shared install core (`src/install.ts`, §10.1): the
 * large-collection guard threshold is part of `add`'s surface — the HTTP mirror
 * in `src/http/routes.ts` reads it from this module — so the name and value
 * stay here although the guard itself now lives in the shared module.
 */
export { LARGE_COLLECTION_THRESHOLD } from '../../install.js';
//# sourceMappingURL=add.d.ts.map
import type { OpsIO } from '../../ops-io.js';
/**
 * `remove <name-or-pattern>...` — delete cloned dirs, remove symlinks, and
 * unregister one or more skills.
 *
 * Accepts exact names and `*`/`?` globs (matched against registered skill
 * names). Every token is resolved to a set of names, de-duplicated, then each
 * name is removed independently: a name that isn't registered is a per-item
 * failure that does not stop the rest, and the exit code is non-zero if any
 * item failed (the same model as `update`).
 *
 * Because a glob can expand to many skills and removal is destructive
 * (deletes the clone + symlinks), a pattern that matches more than one skill is
 * guarded: the full deletion set is shown and confirmation is required unless
 * `--yes` is given. On a non-TTY (scripts) the guard cannot prompt, so it
 * refuses with exit code 2 rather than silently deleting everything matched.
 * Exact single names are unaffected — they remove immediately, as before.
 *
 * `--group <path>` is the batch form of the trae-cn link channel: it matches
 * every entry whose `groupPath` starts with the prefix, segment by segment (the
 * same rule `toggle --group` uses), and is mutually exclusive with name
 * patterns. A group matching several entries gets the same confirmation guard
 * as a broad glob, and an empty group is an error (exit 1), not an empty
 * success.
 *
 * `--json` (P0 §4.4) reports one result per resolved name. The broad-glob guard
 * deliberately keeps its behaviour under `--json`: the machine `OpsIO` is
 * non-interactive, so a multi-match glob without `--yes` is still refused
 * (exit 2) rather than confirmed — a JSON run configures nothing, and
 * "silently delete everything the glob matched" is not a safer default just
 * because the caller wants structured output. Pass `--yes` to proceed.
 */
export declare function remove(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=remove.d.ts.map
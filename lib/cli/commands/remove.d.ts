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
 */
export declare function remove(argv: string[]): Promise<number>;
//# sourceMappingURL=remove.d.ts.map
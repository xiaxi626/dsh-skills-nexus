/**
 * `add` — clone a GitHub SKILL.md repo and register it in the manifest.
 *
 * The repo lands under <skills>/<path>/; the manifest stores how to re-fetch it
 * so `update` can fast-forward later. The skill is enabled by default.
 *
 * When the user does not specify a `#ref`, we detect the remote's default
 * branch via `git ls-remote --symref` instead of hardcoding `main`.
 *
 * `--subdir <path>` installs a single subdirectory of the clone (collection
 * repos like `trae-skills`): the subdir becomes the skill root, the entry gets
 * a `subdir` field, and the clone directory is dedicated to that entry
 * (independent-clone design — see docs/subdir-design.md).
 *
 * Before registering, the clone is *previewed* with the full skill rules, so
 * repos that yield zero installable skills (docs-only roots, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export declare function add(argv: string[]): Promise<number>;
/** Repos with > this many skills trigger the "install all?" guard (unless --subdir/--yes). */
export declare const LARGE_COLLECTION_THRESHOLD = 20;
//# sourceMappingURL=add.d.ts.map
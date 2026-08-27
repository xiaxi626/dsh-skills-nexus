/**
 * `add` — clone a GitHub SKILL.md repo and expose it via a symlink in the
 * official DSH skills root.
 *
 * The clone lands under <repos>/<path>/ and a symlink is created at
 * ~/.dsh/skills/<name>/ so the official filesystem provider discovers it
 * automatically. Multi-skill repos create one symlink per discovered skill.
 *
 * `--subdir <path>` installs a single subdirectory of the clone (collection
 * repos): the subdir is the skill root, the entry gets a `subdir` field, and
 * the clone directory is dedicated to that entry (independent-clone design).
 *
 * Before registering, the clone is *previewed* with the full skill rules, so
 * repos that yield zero installable skills are rejected.
 */
export declare function add(argv: string[]): Promise<number>;
/** Repos with > this many skills trigger the "install all?" guard (unless --subdir/--yes). */
export declare const LARGE_COLLECTION_THRESHOLD = 20;
//# sourceMappingURL=add.d.ts.map
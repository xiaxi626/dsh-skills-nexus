/**
 * Locate the project a working directory belongs to.
 *
 * The rule is the DSH provider's own: walk up from `cwd` to the nearest
 * ancestor that contains a `.git` entry, and fall back to `cwd` itself when
 * no ancestor has one. That means a command run from a nested source
 * directory still targets the same `<project>/.dsh/skills` the provider scans
 * while the session runs there.
 *
 * `existsSync` (rather than `stat` + `isDirectory`) is deliberate: a linked
 * worktree puts a **file** at `.git`, and both forms identify a project root
 * equally well for this purpose.
 */
export declare function detectProjectRoot(cwd: string): string;
//# sourceMappingURL=project-root.d.ts.map
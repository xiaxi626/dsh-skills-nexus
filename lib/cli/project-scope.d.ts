/**
 * Resolve the project root a `--project` command should act on.
 *
 * An explicit `--project-root` is taken literally: if it does not name an
 * existing directory the command fails instead of guessing an ancestor, because
 * a typo there would silently operate on a different project. Without it, the
 * root comes from `detectProjectRoot(cwd)` — the same nearest-`.git` rule the
 * DSH provider uses, so the command and the running session agree.
 */
export type ProjectScope = {
    root: string;
} | {
    error: string;
};
export declare function resolveProjectScope(projectRoot: string | undefined): Promise<ProjectScope>;
//# sourceMappingURL=project-scope.d.ts.map
/**
 * Lightweight shape of the host's workspace registry. We deliberately do
 * NOT import `@deepseek-ai/dsh-workspace` — this module must work on
 * headless hosts where that package is absent.
 */
export interface WorkspaceRegistryLike {
    /** Return every registered workspace row. Throw on registry error. */
    list(): unknown[];
}
/**
 * One registered workspace row as we expose it to the HTTP routes. The
 * host's own row shape is opaque; we derive everything we need from it.
 */
export interface WorkspaceRow {
    /** Stable host-assigned id; falls back to `path` if missing. */
    id: string;
    /** Absolute filesystem path of the workspace root. */
    path: string;
    /** Human-provided display title, if any. */
    title: string;
    /** The nearest ancestor containing `.git`. */
    projectRoot: string;
    /** True if the workspace path is currently accessible. */
    exists: boolean;
}
/**
 * Reflectively read the workspace registry from an host context. Returns
 * `undefined` when the host does not expose it (headless / CLI profile).
 */
export declare function workspaceRegistryOf(ctx: any): WorkspaceRegistryLike | undefined;
/** Walk ancestors until we find a directory containing `.git`. Returns root. */
export declare function detectProjectRoot(start: string): Promise<string>;
export declare function listWorkspaces(registry: WorkspaceRegistryLike): Promise<WorkspaceRow[]>;
/** Shape of resolveWorkspaceTarget's `available` failure. */
export type ResolveTargetResult = {
    ok: true;
    path: string;
} | {
    ok: false;
    reason: 'invalid-path' | 'unavailable' | 'unregistered' | 'unsafe-root';
};
/**
 * Resolve the user-supplied workspace path against the registry. The path in
 * the request is treated as an **authorisation key** — we never trust it
 * directly; we cross-check against registered rows first, then verify the
 * resulting .dsh chain is not a symlink that would redirect writes outside
 * the workspace.
 */
export declare function resolveWorkspaceTarget(registry: WorkspaceRegistryLike, requested: string): Promise<ResolveTargetResult>;
//# sourceMappingURL=workspaces.d.ts.map
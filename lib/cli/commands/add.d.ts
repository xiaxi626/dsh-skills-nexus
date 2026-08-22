/**
 * `add` — clone a GitHub SKILL.md repo and register it in the manifest.
 *
 * The repo lands under <skills>/<path>/; the manifest stores how to re-fetch it
 * so `update` can fast-forward later. The skill is enabled by default.
 *
 * When the user does not specify a `#ref`, we detect the remote's default
 * branch via `git ls-remote --symref` instead of hardcoding `main`.
 */
export declare function add(argv: string[]): Promise<number>;
//# sourceMappingURL=add.d.ts.map
/**
 * `update [name]` — bring a skill's clone to the latest state, or verify a
 * pinned one.
 *
 * Dispatch is decided by how the clone was pinned at `add` time:
 *
 *   - branch pin (symbolic HEAD)  → `git pull --ff-only`, print the commit
 *     change (if any) and re-stamp the manifest `commit`.
 *   - tag / commit pin (detached) → a fixed point: `git pull` cannot
 *     fast-forward a detached HEAD, so never pull. Verify the checkout still
 *     matches the pin and restore it if it drifted.
 *
 * After a successful update the manifest's `commit` is re-stamped, so `list`
 * always shows the exact installed version ("lockfile-lite").
 */
export declare function update(argv: string[]): Promise<number>;
//# sourceMappingURL=update.d.ts.map
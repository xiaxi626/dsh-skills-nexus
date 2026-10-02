/**
 * Delete one skill by exact name — the single implementation behind both the
 * CLI `remove` command and the plugin's `POST /remove` route.
 *
 * Order and link-name derivation are the v0.3.0 behaviour, moved here
 * unchanged: unregister first, then walk the skills the clone currently yields
 * and delete the link each one would have been created under — `previewSkills`
 * names for a multi-skill repo, the entry name for a single-skill one, with the
 * entry name tried once more as a fallback — then delete the clone directory.
 *
 * Links are *derived by name*, not attributed by readlink target: a symlink
 * someone created by hand that happens to point into this clone is not removed
 * by this operation. That is the long-standing CLI contract, kept deliberately
 * so both faces of the operation behave identically; the residue such an alias
 * leaves behind is what `doctor`'s orphan-link check reports.
 */
export interface RemoveResult {
    /** False when no entry carries that name — nothing else was touched. */
    removed: boolean;
    /** Link names actually unlinked; feeds the route's `links` + `hotReload`. */
    links: string[];
}
/**
 * Unregister the entry `name`, delete the links its skills are exposed under,
 * and remove its clone directory.
 *
 * @param name - registered entry name.
 * @returns whether an entry was removed, plus the links deleted with it.
 */
export declare function removeSkill(name: string): Promise<RemoveResult>;
//# sourceMappingURL=remove.d.ts.map
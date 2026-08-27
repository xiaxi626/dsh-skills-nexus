/**
 * Parse cloned repos into concrete, parsed skills.
 *
 * One cloned repo may yield multiple skills — e.g. a repo that bundles
 * `<name>/SKILL.md` per subdirectory. Used by `add` for preview and by
 * `update` for re-normalization.
 *
 * When an entry has a `subdir`, the skill root is that subdirectory inside
 * the clone — this is how collection repos are installed piecemeal (`--subdir`).
 */
/** A parsed skill without the manifest entry — used for add-time preview. */
export interface ParsedSkill {
    skillFile: string;
    resourceBase: string;
    /** Frontmatter `name` (may be empty — callers fall back to an entry/root name). */
    name: string;
    /**
     * Set when the frontmatter `name` was present but violates DSH's skill-name
     * rules — the skill would be silently skipped by the official provider.
     * Kept so `add` can warn and normalize.
     */
    invalidName?: string;
    /** Frontmatter `description` (may be empty). */
    description: string;
    body: string;
    modelInvocable: boolean;
    userInvocable: boolean;
}
/**
 * DSH skill name validation — matches the official `SKILL_NAME` regex:
 *   `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
 *
 * Lowercase letters and digits only, separated by single dashes.
 * No dots, underscores, or consecutive dashes. An invalid frontmatter name
 * causes the official filesystem provider to silently skip that skill, so
 * nexus normalizes such names at install time and warns the user.
 */
export declare function isValidSkillName(name: string): boolean;
/**
 * Preview which skills a directory would yield under the full skill rules —
 * used by `add` before registering, so empty results (docs-only repos, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export declare function previewSkills(dir: string): Promise<ParsedSkill[]>;
//# sourceMappingURL=resolve.d.ts.map
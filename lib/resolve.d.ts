import type { SkillEntry } from './types.js';
/**
 * Resolve manifest entries into concrete, parsed skills.
 *
 * One manifest entry (a cloned repo) may yield multiple skills — e.g. a repo
 * that bundles `<name>/SKILL.md` per subdirectory. The skill name is taken from
 * each file's frontmatter `name` (falling back to the entry name) so multi-skill
 * repos surface correctly in the catalog.
 *
 * When an entry has a `subdir`, the skill root is that subdirectory inside the
 * clone — this is how collection repos are installed piecemeal (`--subdir`).
 */
export interface ResolvedSkill {
    entry: SkillEntry;
    skillFile: string;
    resourceBase: string;
    name: string;
    description: string;
    body: string;
    modelInvocable: boolean;
    userInvocable: boolean;
}
/** A parsed skill without the manifest entry — used by resolveAll and add-time preview. */
export interface ParsedSkill {
    skillFile: string;
    resourceBase: string;
    /** Frontmatter `name` (may be empty — callers fall back to an entry/root name). */
    name: string;
    /**
     * Set when the frontmatter `name` was present but violates DSH's skill-name
     * rules — the skill is registered under the fallback name instead. Kept so
     * `add` can warn the user about the rename.
     */
    invalidName?: string;
    /** Frontmatter `description` (may be empty). */
    description: string;
    body: string;
    modelInvocable: boolean;
    userInvocable: boolean;
}
/**
 * DSH skill names are lowercase kebab-case: start with a lowercase letter or
 * digit, then lowercase letters / digits / `.` / `_` / `-`. A frontmatter
 * `name` that violates this makes DSH reject the whole provider ("invalid
 * skill name"), so such names fall back to the entry name instead.
 */
export declare function isValidSkillName(name: string): boolean;
export declare function resolveAll(): Promise<ResolvedSkill[]>;
export declare function resolveByName(name: string): Promise<ResolvedSkill | null>;
/**
 * Preview which skills a directory would yield under the full skill rules —
 * used by `add` before registering, so empty results (docs-only repos, nested
 * collections without `--subdir`) are rejected instead of "fake-installed".
 */
export declare function previewSkills(dir: string): Promise<ParsedSkill[]>;
//# sourceMappingURL=resolve.d.ts.map
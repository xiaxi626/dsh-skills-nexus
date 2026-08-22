import type { SkillEntry } from './types.js';
/**
 * Resolve manifest entries into concrete, parsed skills.
 *
 * One manifest entry (a cloned repo) may yield multiple skills — e.g. a repo
 * that bundles `<name>/SKILL.md` per subdirectory. The skill name is taken from
 * each file's frontmatter `name` (falling back to the entry name) so multi-skill
 * repos surface correctly in the catalog.
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
export declare function resolveAll(): Promise<ResolvedSkill[]>;
export declare function resolveByName(name: string): Promise<ResolvedSkill | null>;
//# sourceMappingURL=resolve.d.ts.map
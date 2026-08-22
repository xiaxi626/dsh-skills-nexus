import type { SkillProvider } from './types.js';
/**
 * The nexus skill provider — the "thin wrapper" that turns cloned SKILL.md
 * repos into DSH skills.
 *
 *   list()  → scans every cloned dir, returns one SkillCandidate per SKILL.md
 *   get()   → reads the chosen SKILL.md, returns its body as content
 *
 * `resourceBase` is built per skill and points at that skill's own directory, so
 * relative paths in the body (references/, scripts/, assets/) resolve against
 * the correct clone.
 */
export declare const PROVIDER_NAME = "dsh-skills-nexus";
/**
 * Catalog rank. The official filesystem provider uses priorities 100–500 for
 * local roots; GitHub-sourced skills sit below user-local ones so a local
 * override always wins. Tunable via the manifest/entry if needed later.
 */
export declare const GITHUB_SKILL_RANK = 600;
export declare const nexusProvider: SkillProvider;
//# sourceMappingURL=provider.d.ts.map
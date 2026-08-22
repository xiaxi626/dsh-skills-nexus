import type { NexusContext } from './types.js';
/**
 * Cordis plugin entry — the single seam DSH loads.
 *
 * Standard thin-wrapper registration pattern:
 *
 *   export const inject = ['skills']
 *   export function apply(ctx) { ctx.skills.registerProvider(() => provider) }
 *
 * The provider serves N skills dynamically discovered from the manifest
 * instead of one hardcoded skill.
 */
/** Cordis plugin name. */
export declare const name = "dsh-skills-nexus";
/** Required capability seam: the skills registry. */
export declare const inject: string[];
/** Register the nexus skill provider on ctx.skills. */
export declare function apply(ctx: NexusContext): void;
export { nexusProvider } from './provider.js';
export { GITHUB_SKILL_RANK, PROVIDER_NAME } from './provider.js';
export type { Manifest, SkillEntry, SkillCandidate, SkillDefinition, SkillProvider } from './types.js';
//# sourceMappingURL=index.d.ts.map
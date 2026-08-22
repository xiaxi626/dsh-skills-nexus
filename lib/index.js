import { nexusProvider, PROVIDER_NAME } from './provider.js';
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
export const name = PROVIDER_NAME;
/** Required capability seam: the skills registry. */
export const inject = ['skills'];
/** Register the nexus skill provider on ctx.skills. */
export function apply(ctx) {
    ctx.skills.registerProvider(() => nexusProvider);
}
export { nexusProvider } from './provider.js';
export { GITHUB_SKILL_RANK, PROVIDER_NAME } from './provider.js';
//# sourceMappingURL=index.js.map
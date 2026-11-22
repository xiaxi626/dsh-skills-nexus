import type { SkillEntry } from './types.js';
/**
 * Per-skill enable/disable — the one core shared by the CLI (`toggle.ts`) and
 * the HTTP toggle route, so both surfaces record the same exclusion intent
 * and apply the same link semantics (§10.1 shared-core rule).
 *
 * `excluded` on the entry records *intent*, orthogonal to the link-derived
 * enabled state: disabling one skill of a multi-skill entry removes its link
 * (when present) and remembers the name so whole-entry enable, `update` and
 * `switch-version` rebuilds never resurrect it; enabling lifts the exclusion
 * and restores the link only while the entry itself is enabled — otherwise
 * the intent is recorded alone and the link follows the next whole enable.
 *
 * The caller holds the per-skill cross-process lock (CLI `withSkillFileLock`,
 * HTTP `lockedFor`); this core takes no lock itself, exactly like
 * `toggleEntryCore` on the HTTP side.
 */
/** Why a per-skill toggle refused; the front ends map it to their dialects. */
export type SkillToggleErrorCode = 'not-found' | 'single-skill' | 'collision';
export declare class SkillToggleError extends Error {
    readonly code: SkillToggleErrorCode;
    constructor(code: SkillToggleErrorCode, message: string);
}
export interface SkillToggleResult {
    /** Links created (enable) or removed (disable); intent-only runs report 0. */
    linksChanged: number;
    /** True when neither the exclusion intent nor any link changed. */
    already: boolean;
    /** Entry-level enabled state after the operation, derived from links. */
    enabled: boolean;
}
export declare function toggleEntrySkill(entry: SkillEntry, skillName: string, enabled: boolean): Promise<SkillToggleResult>;
//# sourceMappingURL=toggle-skill.d.ts.map
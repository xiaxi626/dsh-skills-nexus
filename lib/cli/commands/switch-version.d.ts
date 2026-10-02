import type { OpsIO } from '../../ops-io.js';
/**
 * `switch-version <name> <ref> [--type <branch|tag|commit>]` — move an
 * entry's clone to another branch / tag / commit.
 *
 * The orchestration is `src/switch-version.ts` (§8.2: fetch → verify →
 * checkout → re-normalize frontmatter → rebuild links, with rollback); this
 * wrapper parses argv, keeps a spinner running while the core works, and maps
 * the core's error classes to exit codes:
 *   0 = switched, 1 = no such skill / ref not found / no git source / other
 *   failure, 2 = usage error.
 *
 * `--type` is the caller's hint (§8.2): the fetch result decides the checkout
 * style, and the hint only orders the offline fallback when nothing landed —
 * every namespace is then tried against the local clone, hint first. Like
 * `refType` in the API it is never persisted.
 *
 * Like `update`, the switch discards local changes in the clone: managed
 * clones are dirty by convention (install-time normalization rewrites
 * SKILL.md), and the core warns before it discards (matching `update`'s text).
 */
/** Values `--type` accepts — the same transient hint the core takes. */
export declare const SUPPORTED_REF_TYPES: readonly ["branch", "tag", "commit"];
export type RefTypeHint = (typeof SUPPORTED_REF_TYPES)[number];
export interface SwitchVersionOptions {
    name: string;
    ref: string;
    refType?: RefTypeHint;
}
/**
 * Parse `switch-version` args: exactly two positionals (`<name> <ref>`) plus
 * an optional `--type` value option (`--type tag` / `--type=tag`, the form
 * every value option in this CLI accepts).
 *
 * An unknown flag, a missing/extra positional or an unknown `--type` value is
 * a usage error — never a silent guess: a typo like `--typ tag` must not
 * silently switch the entry under an unintended interpretation.
 */
export declare function parseSwitchVersionArgs(argv: string[]): SwitchVersionOptions;
export declare function switchVersion(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=switch-version.d.ts.map
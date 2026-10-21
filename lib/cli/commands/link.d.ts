import type { OpsIO } from '../../ops-io.js';
/**
 * `link <source>` — register external skills as manifest entries and create
 * symlinks in the official DSH skills root.
 *
 * Currently only `trae-cn` is accepted as a source. The command discovers
 * skills under `~/.trae-cn/skills/`, creates manifest entries with
 * `ownership: 'external'`, and symlinks each skill into
 * `~/.dsh/skills/` under a flat name derived from its group path.
 *
 * Semantics mirror `import`: source is required, `--dry-run` previews, without
 * it the command executes. `--json` emits a structured report.
 *
 * Exit codes: 0 = done, 1 = error, 2 = usage error.
 */
export declare function link(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=link.d.ts.map
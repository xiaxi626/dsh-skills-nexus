import type { OpsIO } from '../../ops-io.js';
/**
 * `link <source>` — register external skills as manifest entries and create
 * symlinks in the official DSH skills root.
 *
 * 按来源配置扫描 trae-cn / trae 的用户技能，创建 ownership: 'external'
 * 条目，并以 groupPath 派生的扁平名称链接到 `~/.dsh/skills/`。
 *
 * Semantics mirror `import`: source is required, `--dry-run` previews, without
 * it the command executes. `--json` emits a structured report.
 *
 * Exit codes: 0 = done, 1 = error, 2 = usage error.
 */
export declare function link(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=link.d.ts.map
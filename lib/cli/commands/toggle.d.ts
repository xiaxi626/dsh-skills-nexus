import type { OpsIO } from '../../ops-io.js';
/**
 * `enable <name>...` / `disable <name>...` — toggle catalog visibility by
 * creating or removing symlinks in the official DSH skills root.
 *
 * The actual clone stays in ~/.dsh/skills-nexus/repos/. enable/disable just
 * controls whether symlinks exist in ~/.dsh/skills/ — lightweight and atomic.
 *
 * Like `remove`, this accepts several names in one run (gap-closure A3): each
 * name is processed independently, a name that is not registered is a per-item
 * failure that does not stop the rest, and the exit code is non-zero if any
 * item failed. `--json` (P0 §4.5) renders the batch as one report.
 *
 * Exit codes: 0 = all done (including "already in that state"), 1 = at least
 * one name failed, 2 = usage error.
 */
export declare function toggle(argv: string[], enabled: boolean, io?: OpsIO): Promise<number>;
//# sourceMappingURL=toggle.d.ts.map
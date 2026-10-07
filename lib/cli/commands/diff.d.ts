import type { OpsIO } from '../../ops-io.js';
export interface DiffOptions {
    name: string;
    ref?: string;
    stat: boolean;
}
/** Parse one entry name, an optional remote ref, and the boolean --stat flag. */
export declare function parseDiffArgs(argv: string[]): DiffOptions;
/** Run a read-only remote comparison while holding the entry's file lock. */
export declare function diff(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=diff.d.ts.map
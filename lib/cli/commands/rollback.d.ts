import type { OpsIO } from '../../ops-io.js';
export declare function parseRollbackArgs(argv: string[]): {
    name: string;
    json: boolean;
};
export declare function rollback(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=rollback.d.ts.map
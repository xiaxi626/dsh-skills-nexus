import type { OpsIO } from './ops-io.js';
export interface UpdateResult {
    name: string;
    ref: string;
    before: string;
    after: string;
    status: 'updated' | 'up-to-date' | 'pinned';
    wasDirty: boolean;
    links: string[];
}
/** 单 entry 更新的唯一核心。调用方负责 per-entry 锁、批量和输出封装。 */
export declare function updateEntry(name: string, io: OpsIO): Promise<UpdateResult>;
//# sourceMappingURL=update.d.ts.map
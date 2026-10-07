import { rename, writeFile } from 'node:fs/promises';
import type { VersionState } from './version-state.js';
import type { OpsIO } from './ops-io.js';
import type { SkillEntry } from './types.js';
/** commit 是实际 HEAD；entry.commit 保留原 manifest 值，包括原有漂移。 */
export interface RollbackState extends VersionState {
    ref: string;
    headType: 'branch' | 'detached';
    locked: boolean;
    updatedAt?: string;
    enabled: boolean;
}
export interface RollbackRecord {
    version: 1;
    name: string;
    anchorRef: string;
    from: RollbackState;
    to: RollbackState;
}
export declare const ROLLBACK_CONSUMED_MESSAGE = "\u6062\u590D\u70B9\u5DF2\u6D88\u8D39\uFF1B\u5982\u9700\u518D\u6B21\u524D\u8FDB\u8BF7\u4F7F\u7528 update/switch-version";
export declare function rollbackPath(name: string): string;
/** 唯有版本身份变更产生恢复点；时间戳与归一化不属于版本身份。 */
export declare function versionChanged(from: VersionState, to: VersionState): boolean;
export interface RollbackStoreIO {
    writeFile: typeof writeFile;
    rename: typeof rename;
}
/**
 * 发布点是 rename：之前失败不改旧记录/旧 anchor；complete 失败时原子恢复旧记录。
 * complete 成功后才清理旧 anchor，垃圾清理不抛错。
 * 唯一 anchor 保留不可达旧对象；中断至多留下孤立 ref，不覆盖其他候选的 ref。
 */
export declare function saveRollbackPoint(from: VersionState, to: VersionState, store?: RollbackStoreIO, complete?: () => void): Promise<void>;
/** 读取及校验始终先于 dirty 丢弃或 checkout。 */
export declare function readRollbackPoint(entry: SkillEntry): Promise<RollbackRecord | undefined>;
export interface RollbackResult {
    name: string;
    status: 'rolled-back';
    fromCommit: string;
    toCommit: string;
    fromRef: string;
    toRef: string;
    wasDirty: boolean;
    links: string[];
}
/** 单次消费，不生成反向恢复点；调用方持有 per-entry 锁。 */
export declare function rollbackEntry(name: string, io: OpsIO): Promise<RollbackResult>;
//# sourceMappingURL=rollback.d.ts.map
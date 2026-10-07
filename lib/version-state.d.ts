import type { EntryLink } from './link.js';
import type { OpsIO } from './ops-io.js';
import type { ParsedSkill } from './resolve.js';
import type { SkillEntry } from './types.js';
/** 过程内快照：登记字段、实际 HEAD 和实际链接分别保存，不相互猜测。 */
export interface VersionState {
    entry: SkillEntry;
    commit: string;
    branch?: string;
    links: EntryLink[];
}
export declare function captureVersionState(entry: SkillEntry): Promise<VersionState>;
/** 只替换本 entry，保留其他 entry 在此期间写入的字段。 */
export declare function restoreEntry(entry: SkillEntry): Promise<void>;
export declare function normalizeCheckout(entry: SkillEntry, io?: OpsIO): Promise<ParsedSkill[]>;
export declare function rebuildVersionLinks(state: VersionState, skills: ParsedSkill[], io?: OpsIO): Promise<string[]>;
/** 每一项恢复均尝试执行；诊断不替代触发恢复的原始错误。 */
export declare function restoreVersionState(state: VersionState): Promise<string[]>;
export declare function recoverVersionFailure(state: VersionState, error: unknown): Promise<never>;
//# sourceMappingURL=version-state.d.ts.map
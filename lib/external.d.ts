/**
 * 通道 E：trae-cn / trae 等本地来源的外部条目核心。
 *
 * 从已配置的本地来源发现技能，注册为 manifest 条目，
 * 并通过 symlink 引用用户自有目录。Nexus 不克隆、拉取、更新或删除
 * 这些目录，只管理 manifest 记录与 `~/.dsh/skills/` 中的链接。
 *
 * The key abstraction is `entrySkillDir`: every read path that used to
 * compute `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`
 * now calls this single function, which redirects external entries to their
 * `externalDir` instead. Without it, external entries would be invisible to
 * toggle, health, list and link scanning.
 */
import type { SkillEntry } from './types.js';
import type { OpsIO } from './ops-io.js';
/**
 * Return the absolute path to the skill root directory for any entry.
 *
 * - **external** entries → `entry.externalDir` (the user-owned directory).
 * - **managed** entries → the existing ternary:
 *   `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`.
 *
 * Implementation discipline: the managed branch must remain byte-for-byte
 * equivalent to the ternary formerly inlined in toggle.ts, routes.ts and
 * remove.ts, so no managed entry regresses.
 */
export declare function entrySkillDir(entry: SkillEntry): string;
/** Trae 两个版本均只扫描用户技能，不包含 builtin_skills。 */
export declare const TRAE_CN_SUBDIRS: readonly ["skills"];
export declare const TRAE_SUBDIRS: readonly ["skills"];
export interface SourceConfig {
    /** 根目录覆盖使用的环境变量名。 */
    envVar: string;
    /** 相对于 homedir 的默认根目录；rootCandidates 优先。 */
    defaultDirName?: string;
    /** 按优先级排列的候选根目录，相对于 homedir。 */
    rootCandidates?: readonly string[];
    /** 相对于每个根目录的技能子目录。 */
    subdirs: readonly string[];
}
export declare const SOURCE_CONFIGS: Record<string, SourceConfig>;
/** 已支持的来源标识，用于帮助、错误提示和补全。 */
export declare const SUPPORTED_SOURCES: string[];
/** Machine-readable codes for link-channel failures (§10.4 dialect). */
export type LinkErrorCode = 'not-found' | 'not-a-skill-dir' | 'already-exists' | 'resolve-failed' | 'name-collision';
/** A link-channel operation was refused or failed. */
export declare class LinkError extends Error {
    readonly code: LinkErrorCode;
    constructor(code: LinkErrorCode, message: string);
}
/** Options accepted by `planLinkLocal` and `linkLocal`. */
export interface LinkOptions {
    /** 覆盖来源根目录；优先于兼容别名和环境变量。 */
    dirOverride?: string;
    /** dirOverride 的兼容别名，保留已有调用方式。 */
    traeCnDir?: string;
    /** 覆盖 L1 组名，默认使用来源标识。 */
    group?: string;
    /** Bypass name-collision checks and overwrite existing entries. */
    force?: boolean;
}
/** 从任意已配置来源发现的技能。 */
export interface DiscoveredSkill {
    /** Which fixed subdir it was found in (currently always 'skills'). */
    subdir: string;
    /** Directory name within that subdir. */
    name: string;
    /** Absolute path to the skill directory. */
    dir: string;
    /** Frontmatter `name` field (for display / conflict diagnostics). */
    skillName: string;
}
/** One planned entry — what `linkLocal` would create. */
export interface LinkPlanEntry {
    /** Flat management name = `groupPath.join('.')`. */
    name: string;
    /** Hierarchical group path, e.g. `['trae-cn', 'skills', 'brainstorming']`. */
    groupPath: string[];
    /** Absolute path to the external skill directory. */
    externalDir: string;
    /** Frontmatter skill name (for display). */
    skillName: string;
}
/** The full preview — every planned entry plus any name collisions. */
export interface LinkPlan {
    /** 来源标识。 */
    source: string;
    /** Entries that would be (or were) created. */
    entries: LinkPlanEntry[];
    /** Names that already exist in the manifest (skipped unless `--force`). */
    conflicts: string[];
}
/** The outcome of a `linkLocal` execution. */
export interface LinkResult {
    /** Flat names that were actually added. */
    added: string[];
    /** Flat names skipped due to conflicts (present even without `--force`). */
    skipped: string[];
}
/**
 * 返回所有存在的候选根目录，保持配置顺序。
 * 优先级：dirOverride > 来源环境变量 > rootCandidates/defaultDirName。
 * 显式覆盖只检查该路径，不回退到默认目录；全部不存在时报 not-found。
 */
export declare function resolveSourceRoots(source: string, opts?: {
    dirOverride?: string;
}): Promise<string[]>;
/**
 * 按根目录优先级扫描各子目录，仅发现一层包含 SKILL.md 的目录。
 * 相同绝对路径只返回一次；不递归扫描嵌套插件布局。
 */
export declare function discoverSkills(roots: string[], subdirs: readonly string[]): Promise<DiscoveredSkill[]>;
/** 兼容现有测试和调用者。 */
export declare function discoverTraeCnSkills(root: string): Promise<DiscoveredSkill[]>;
/**
 * Build a link plan without creating anything.
 *
 * source 必须存在于 SOURCE_CONFIGS，否则抛出 LinkError。
 * 多根下生成同一管理名称时，优先根中的技能胜出。
 *
 * The plan contains one entry per discovered skill, with:
 *   - `groupPath` = `[group ?? source, subdir, dirName]`
 *   - `name` = `groupPath.join('.')`
 *   - `externalDir` = absolute path to the skill directory
 *
 * Names that already exist in the manifest are reported as conflicts.
 */
export declare function planLinkLocal(source: string, opts?: LinkOptions): Promise<LinkPlan>;
/**
 * Execute the link plan: write manifest entries and create symlinks.
 *
 * For each planned entry:
 *   1. Construct a `SkillEntry` with `ownership: 'external'`, `externalDir`,
 *      and `groupPath`.
 *   2. Add it to the manifest via `addEntry`.
 *   3. Create a symlink in `~/.dsh/skills/<flat-name>` → `externalDir`.
 *
 * Returns the plan plus the result (which entries were added / skipped).
 */
export declare function linkLocal(source: string, opts?: LinkOptions, io?: OpsIO): Promise<{
    plan: LinkPlan;
    result: LinkResult;
}>;
//# sourceMappingURL=external.d.ts.map
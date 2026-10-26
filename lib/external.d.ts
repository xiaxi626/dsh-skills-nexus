/**
 * 通道 E：本地来源的外部条目核心。
 *
 * 每个来源在 `SOURCE_CONFIGS` 里登记一个 vendor 根 + 一个发现函数；当前十九个
 * 来源里，除 qoder / qoder-cn 复用 `discoverQoder`（用户级 skills + 市场插件
 * 两套命名空间）外，其余全部是 `plainDiscovery(['skills'])`——即"客户端把个人
 * 技能放在 <root>/skills/<name>/SKILL.md"这一层。
 *
 * 环境变量命名规则：取默认根目录名的末段 token，逐段大写加 `_DIR`（`.kimi-code`
 * → `KIMI_CODE_DIR`）。例外两条：客户端有官方"配置根"变量且语义严格等于本注册表
 * 的根时复用官方名；目录名不带产品标识时按来源 id 取值（`.agents` → `SHARED_DIR`）。
 * `KIMI_CODE_HOME` 与 `GEMINI_CLI_HOME` 不属于此类——它们替换的是客户端自己的数据
 * 根/home，不是 nexus 的扫描根。
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
/**
 * 从**单个**来源根目录发现技能。各来源自带发现逻辑：布局差异较大时
 * （插件式来源一个根下挂多个插件）不必把分支写进 `planLinkLocal`。
 */
export type DiscoverFn = (root: string) => Promise<DiscoveredSkill[]>;
export interface SourceConfig {
    /** 根目录覆盖使用的环境变量名。 */
    envVar: string;
    /** 相对于 homedir 的默认根目录；rootCandidates 优先。 */
    defaultDirName?: string;
    /** 按优先级排列的候选根目录，相对于 homedir。 */
    rootCandidates?: readonly string[];
    /** 单个根目录的技能发现逻辑。 */
    discover: DiscoverFn;
}
/** 固定子目录布局（除 qoder 系外的全部来源）：逐个子目录扫描一层。 */
export declare function plainDiscovery(subdirs: readonly string[]): DiscoverFn;
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
    /**
     * 来源内的分组段，构成 `groupPath` 的第二段：固定子目录布局下是子目录名
     * （`skills`），插件式布局下是插件名。
     */
    segment: string;
    /** Directory name within that segment. */
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
 * Read the frontmatter `name` from a SKILL.md file. Returns '' when the file
 * is absent, has no frontmatter, or the name field is missing/empty.
 *
 * Exported for other source modules (`qoder.ts`) so their own layouts can reuse
 * the one frontmatter reader instead of duplicating the regex + YAML handling.
 */
export declare function readSkillName(skillFile: string): Promise<string>;
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
 *   - `groupPath` = `[group ?? source, segment, dirName]`
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
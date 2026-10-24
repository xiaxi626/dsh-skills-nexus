/**
 * `qoder` 来源：Qoder 客户端的用户级技能 + 市场安装的插件技能。
 *
 * 一个 `<root>`（默认 `~/.qoder`）下挂着两种布局：
 *
 *   <root>/skills/<技能目录>/SKILL.md            → segment `skills`
 *   <root>/plugins/installed_plugins_v2.json     → 已安装插件清单（只读）
 *   <installPath>/.qoder-plugin/plugin.json      → 插件声明的 skills 目录
 *
 * ## 为什么排除 `qoder-bundler`
 *
 * 这些插件随客户端下发，其 SKILL.md 依赖 Qoder 宿主运行时（用 `../..` 定位
 * 插件根、`${QODER_PLUGIN_ROOT}`、`~/.qodersec/bin`），单独链接后整体不可用，
 * 且缓存内容随客户端版本被改写。与 trae 侧"只纳 `skills/`、不纳
 * `builtin_skills`"同一原则：随客户端下发的归客户端。
 *
 * ## 职责边界
 *
 * 本模块是 qoder 布局的唯一知识来源。`external.ts` 只把它当成一个
 * `discover` 函数（`(root) => DiscoveredSkill[]`），不出现任何来源分支；
 * 命名、去重、冲突、链接仍由 `planLinkLocal` / `linkLocal` 统一处理。
 */
import type { DiscoveredSkill } from './external.js';
/** 清单里的一条插件安装记录，已从 `key@publisher` 拆开。 */
export interface InstalledPlugin {
    /** 清单键，形如 `<插件>@<publisher>`。 */
    key: string;
    /** 插件名：键中最后一个 `@` 之前的部分，用作 `groupPath` 的段名。 */
    pluginName: string;
    /** 分发方：键中最后一个 `@` 之后的部分。 */
    publisher: string;
    /** 安装目录；清单里缺失或非字符串时为 undefined。 */
    installPath?: string;
    /** 面板里被禁用的插件不纳入；缺省视为启用。 */
    enabled: boolean;
}
/** `plugin.json` 里与本次发现相关的字段。 */
export interface PluginManifest {
    /** 技能目录，相对 `installPath`；缺省 `['./skills/']`。 */
    skills: string[];
}
/**
 * 只读 `<root>/plugins/installed_plugins_v2.json`。
 *
 * 清单缺失、损坏或没有 `plugins` 对象时返回空数组（不是错误）：没装过插件的
 * 机器只应得到用户级技能。一个键可以对应多条安装记录，全部展开。
 */
export declare function readInstalledPlugins(root: string): Promise<InstalledPlugin[]>;
/**
 * 读插件的 `plugin.json`：`.qoder-plugin/plugin.json` 优先，其次安装根目录的
 * `plugin.json`；两份都不存在或不可解析时按 `./skills/` 处理。
 */
export declare function readPluginManifest(installPath: string): Promise<PluginManifest>;
/**
 * 发现一个 qoder 根目录下的全部技能。
 *
 * 顺序即优先级：用户级 `<root>/skills` 在前，其后是清单顺序的插件。
 * 同名技能（按 frontmatter `name`，缺失时退回目录名）只保留首次出现的
 * 那一条 —— 用户自装的版本优先于插件携带的版本；插件之间先到先得。
 */
export declare function discoverQoder(root: string): Promise<DiscoveredSkill[]>;
//# sourceMappingURL=qoder.d.ts.map
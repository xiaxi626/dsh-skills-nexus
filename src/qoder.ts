/**
 * `qoder` / `qoder-cn` 来源：Qoder 客户端的用户级技能 + 市场安装的插件技能。
 *
 * 同一套布局服务两个根：`qoder` 默认 `~/.qoder`，`qoder-cn` 默认 `~/.qoder-cn`。
 * 一个 `<root>` 下挂着两种布局：
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
 * 本模块是 qoder 系布局（两个客户端根共用）的唯一知识来源。`external.ts` 只把它当成一个
 * `discover` 函数（`(root) => DiscoveredSkill[]`），不出现任何来源分支；
 * 命名、去重、冲突、链接仍由 `planLinkLocal` / `linkLocal` 统一处理。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { readSkillName } from './external.js'
import type { DiscoveredSkill } from './external.js'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * 随客户端下发的 publisher —— 其插件依赖 Qoder 宿主运行时，不纳入。
 * `~/.qoder-cn` 实测同为该 publisher：其 4 个内置插件全部 `@qoder-bundler`。
 */
const BUILTIN_PUBLISHERS = ['qoder-bundler']

/** 插件未声明 `skills` 时使用的目录。 */
const DEFAULT_SKILLS_DIR = './skills/'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** 清单里的一条插件安装记录，已从 `key@publisher` 拆开。 */
export interface InstalledPlugin {
  /** 清单键，形如 `<插件>@<publisher>`。 */
  key: string
  /** 插件名：键中最后一个 `@` 之前的部分，用作 `groupPath` 的段名。 */
  pluginName: string
  /** 分发方：键中最后一个 `@` 之后的部分。 */
  publisher: string
  /** 安装目录；清单里缺失或非字符串时为 undefined。 */
  installPath?: string
  /** 面板里被禁用的插件不纳入；缺省视为启用。 */
  enabled: boolean
}

/** `plugin.json` 里与本次发现相关的字段。 */
export interface PluginManifest {
  /** 技能目录，相对 `installPath`；缺省 `['./skills/']`。 */
  skills: string[]
}

/* ------------------------------------------------------------------ */
/* Installed-plugin manifest                                           */
/* ------------------------------------------------------------------ */

/**
 * 只读 `<root>/plugins/installed_plugins_v2.json`。
 *
 * 清单缺失、损坏或没有 `plugins` 对象时返回空数组（不是错误）：没装过插件的
 * 机器只应得到用户级技能。一个键可以对应多条安装记录，全部展开。
 */
export async function readInstalledPlugins(root: string): Promise<InstalledPlugin[]> {
  const file = join(root, 'plugins', 'installed_plugins_v2.json')
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return []
  }
  const plugins = (doc as { plugins?: unknown } | null)?.plugins
  if (plugins === null || typeof plugins !== 'object') return []

  const out: InstalledPlugin[] = []
  for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
    const at = key.lastIndexOf('@')
    const pluginName = at > 0 ? key.slice(0, at) : key
    const publisher = at > 0 ? key.slice(at + 1) : ''
    const records: unknown[] = Array.isArray(value) ? value : [value]
    for (const record of records) {
      if (record === null || typeof record !== 'object') continue
      const installPath = (record as { installPath?: unknown }).installPath
      out.push({
        key,
        pluginName,
        publisher,
        installPath: typeof installPath === 'string' && installPath !== '' ? installPath : undefined,
        // 只有显式 false 才算禁用：清单里没有该字段的旧记录视为启用。
        enabled: (record as { enabled?: unknown }).enabled !== false,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Plugin manifest                                                     */
/* ------------------------------------------------------------------ */

/**
 * 读插件的 `plugin.json`：`.qoder-plugin/plugin.json` 优先，其次安装根目录的
 * `plugin.json`；两份都不存在或不可解析时按 `./skills/` 处理。
 */
export async function readPluginManifest(installPath: string): Promise<PluginManifest> {
  for (const candidate of [
    join(installPath, '.qoder-plugin', 'plugin.json'),
    join(installPath, 'plugin.json'),
  ]) {
    let raw: string
    try {
      raw = await readFile(candidate, 'utf8')
    } catch {
      continue
    }
    let declared: unknown
    try {
      declared = (JSON.parse(raw) as { skills?: unknown } | null)?.skills
    } catch {
      continue
    }
    const skills = typeof declared === 'string'
      ? [declared]
      : Array.isArray(declared)
        ? declared.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
        : []
    return { skills: skills.length > 0 ? skills : [DEFAULT_SKILLS_DIR] }
  }
  return { skills: [DEFAULT_SKILLS_DIR] }
}

/* ------------------------------------------------------------------ */
/* Skill collection                                                    */
/* ------------------------------------------------------------------ */

async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'SKILL.md'))).isFile()
  } catch {
    return false
  }
}

/**
 * 收集一个**声明目录**里的技能。
 *
 * - 目录自身带 `SKILL.md` → 算一个技能（`skills/foo/SKILL.md` 这种单技能目录）。
 * - 否则只看一层子目录：`<dir>/<子目录>/SKILL.md`，跳过隐藏项与非目录。
 *
 * 刻意不递归：`skills/case-studies/demo/SKILL.md` 这类二级嵌套属于插件内部
 * 结构，单独链接后 `../` 相对引用会失效，不属于"技能"。
 */
async function collectDeclaredSkills(segment: string, dir: string): Promise<DiscoveredSkill[]> {
  if (await hasSkillFile(dir)) {
    return [{ segment, name: basename(dir), dir, skillName: await readSkillName(join(dir, 'SKILL.md')) }]
  }
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // 声明目录不存在时静默跳过：插件可以声明一个尚未创建的目录。
    return []
  }
  const out: DiscoveredSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillDir = join(dir, entry.name)
    if (!(await hasSkillFile(skillDir))) continue
    out.push({
      segment,
      name: entry.name,
      dir: skillDir,
      skillName: await readSkillName(join(skillDir, 'SKILL.md')),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* discoverQoder                                                       */
/* ------------------------------------------------------------------ */

/**
 * 发现一个 qoder 根目录下的全部技能。
 *
 * 顺序即优先级：用户级 `<root>/skills` 在前，其后是清单顺序的插件。
 * 同名技能（按 frontmatter `name`，缺失时退回目录名）只保留首次出现的
 * 那一条 —— 用户自装的版本优先于插件携带的版本；插件之间先到先得。
 */
export async function discoverQoder(root: string): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = []
  const seenNames = new Set<string>()
  const push = (skill: DiscoveredSkill): void => {
    const key = skill.skillName === '' ? skill.name : skill.skillName
    if (seenNames.has(key)) return
    seenNames.add(key)
    out.push(skill)
  }

  // 1. 用户级技能。
  for (const skill of await collectDeclaredSkills('skills', join(root, 'skills'))) push(skill)

  // 2. 市场安装的插件。
  for (const plugin of await readInstalledPlugins(root)) {
    if (BUILTIN_PUBLISHERS.includes(plugin.publisher)) continue
    if (!plugin.enabled) continue
    if (plugin.installPath === undefined) continue
    try {
      if (!(await stat(plugin.installPath)).isDirectory()) continue
    } catch {
      continue
    }
    const manifest = await readPluginManifest(plugin.installPath)
    for (const declared of manifest.skills) {
      const dir = join(plugin.installPath, declared)
      for (const skill of await collectDeclaredSkills(plugin.pluginName, dir)) push(skill)
    }
  }

  return out
}

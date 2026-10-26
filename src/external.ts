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

import { homedir } from 'node:os'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { repoDir } from './paths.js'
import { addEntry, readManifest, removeEntry } from './manifest.js'
import { hasCollision, linkSkill } from './link.js'
// qoder.ts 反向 import 本模块的 readSkillName，构成 ESM 函数级循环：两侧只在
// 函数体内互相调用，模块求值期不触达对方，因此不存在 TDZ 问题。
import { discoverQoder } from './qoder.js'
import type { SkillEntry } from './types.js'
import type { OpsIO } from './ops-io.js'

/* ------------------------------------------------------------------ */
/* entrySkillDir — the single read-path resolver                     */
/* ------------------------------------------------------------------ */

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
export function entrySkillDir(entry: SkillEntry): string {
  // New-style external entries (from the trae-cn link channel) carry
  // `externalDir`. Old-style external entries (from `--link-only` adoption)
  // use `path` like managed entries but with `ownership: 'external'`.
  if (entry.ownership === 'external' && entry.externalDir) return entry.externalDir
  const dir = repoDir(entry.path)
  return entry.subdir ? join(dir, entry.subdir) : dir
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Trae 两个版本均只扫描用户技能，不包含 builtin_skills。 */
export const TRAE_CN_SUBDIRS = ['skills'] as const
export const TRAE_SUBDIRS = ['skills'] as const

/**
 * 从**单个**来源根目录发现技能。各来源自带发现逻辑：布局差异较大时
 * （插件式来源一个根下挂多个插件）不必把分支写进 `planLinkLocal`。
 */
export type DiscoverFn = (root: string) => Promise<DiscoveredSkill[]>

export interface SourceConfig {
  /** 根目录覆盖使用的环境变量名。 */
  envVar: string
  /** 相对于 homedir 的默认根目录；rootCandidates 优先。 */
  defaultDirName?: string
  /** 按优先级排列的候选根目录，相对于 homedir。 */
  rootCandidates?: readonly string[]
  /** 单个根目录的技能发现逻辑。 */
  discover: DiscoverFn
}

/** 固定子目录布局（除 qoder 系外的全部来源）：逐个子目录扫描一层。 */
export function plainDiscovery(subdirs: readonly string[]): DiscoverFn {
  return (root) => discoverSkills([root], subdirs)
}

export const SOURCE_CONFIGS: Record<string, SourceConfig> = {
  'trae-cn': { envVar: 'TRAE_CN_DIR', defaultDirName: '.trae-cn', discover: plainDiscovery(TRAE_CN_SUBDIRS) },
  trae: { envVar: 'TRAE_DIR', defaultDirName: '.trae', discover: plainDiscovery(TRAE_SUBDIRS) },
  // qoder 一个根下挂着用户级 skills 与市场插件两套命名空间，发现逻辑在 qoder.ts。
  qoder: { envVar: 'QODER_DIR', defaultDirName: '.qoder', discover: discoverQoder },
  // qoder-cn 是同一布局的另一个客户端根：复用 discoverQoder，不另建发现器。
  'qoder-cn': { envVar: 'QODER_CN_DIR', defaultDirName: '.qoder-cn', discover: discoverQoder },
  // codebuddy / workbuddy：客户端把用户安装的技能直接落在 <root>/skills/ 一层，
  // 与 trae 同构；两者根下的其他子目录用途未证实，本次不纳管。
  codebuddy: { envVar: 'CODEBUDDY_DIR', defaultDirName: '.codebuddy', discover: plainDiscovery(['skills']) },
  workbuddy: { envVar: 'WORKBUDDY_DIR', defaultDirName: '.workbuddy', discover: plainDiscovery(['skills']) },

  // 以下十三个来源同属"用户级一层 SKILL.md 目录"契约：客户端把个人技能放在
  // <root>/skills/<name>/SKILL.md，没有插件清单、没有版本层。每个来源只扫自己的
  // vendor 根；兼容目录（.agents / .claude / .codex）一律不并入，否则同一物理
  // 目录会被注册成多条。其中 .agents 单独登记为 shared。

  // copilot：个人技能 ~/.copilot/skills；COPILOT_HOME 替换整个 ~/.copilot 路径。
  copilot: { envVar: 'COPILOT_HOME', defaultDirName: '.copilot', discover: plainDiscovery(['skills']) },
  // claude-code：个人技能 ~/.claude/skills；CLAUDE_CONFIG_DIR 替换配置根。
  // synced/（claude.ai 同步，会移入 .trash）、plugins/、legacy commands/*.md 均在契约外。
  'claude-code': { envVar: 'CLAUDE_CONFIG_DIR', defaultDirName: '.claude', discover: plainDiscovery(['skills']) },
  // pi：个人技能在 <agent dir>/skills，默认 ~/.pi/agent；PI_CODING_AGENT_DIR 覆盖 agent 目录。
  pi: { envVar: 'PI_CODING_AGENT_DIR', defaultDirName: '.pi/agent', discover: plainDiscovery(['skills']) },
  // codex：$CODEX_HOME/skills（默认 ~/.codex）是 Codex 仍在读取的旧个人位置；
  // 官方当前 User 位置是 ~/.agents/skills，由 shared 来源承载。内置 .system/ 不纳管。
  codex: { envVar: 'CODEX_HOME', defaultDirName: '.codex', discover: plainDiscovery(['skills']) },
  // cursor：用户级 ~/.cursor/skills；Cursor 还会递归扫描分类子目录并兼容 .claude/.codex，
  // 本契约只认一层，分类子目录与兼容根都不纳入。
  cursor: { envVar: 'CURSOR_DIR', defaultDirName: '.cursor', discover: plainDiscovery(['skills']) },
  // shared：跨工具共享目录 ~/.agents/skills，同时是 codex / copilot / cursor / gemini /
  // kimi-code 的官方兼读位置、openclaw 的 personal 兼容根。只在这里登记一次。
  shared: { envVar: 'SHARED_DIR', defaultDirName: '.agents', discover: plainDiscovery(['skills']) },
  // opencode：全局配置根 ~/.config/opencode；OPENCODE_CONFIG_DIR 覆盖配置目录。
  opencode: { envVar: 'OPENCODE_CONFIG_DIR', defaultDirName: '.config/opencode', discover: plainDiscovery(['skills']) },
  // gemini：~/.gemini/skills 与 ~/.agents/skills 是别名位置，同一 tier 内 .agents 优先；
  // 后者已由 shared 承载。GEMINI_CLI_HOME 替换的是 home（CLI 会在其下自建 .gemini），
  // 不能当根覆盖用，故用 nexus 侧变量。
  gemini: { envVar: 'GEMINI_DIR', defaultDirName: '.gemini', discover: plainDiscovery(['skills']) },
  // zcode：用户级 ~/.zcode/skills；官方未提供配置根环境变量。插件市场分发的技能
  // （单层目录）与设置页导入后的副本都最终落在 <root>/skills/ 下。
  zcode: { envVar: 'ZCODE_DIR', defaultDirName: '.zcode', discover: plainDiscovery(['skills']) },
  // openclaw：~/.openclaw/skills 是 state dir 下的共享库，也是 `skills install --global`
  // 的目标；OPENCLAW_STATE_DIR 整体替换 state dir（指向别处时 openclaw 自己会排除
  // ~/.agents/skills，与本契约一致）。bundled / plugin / workshop 技能不纳管。
  openclaw: { envVar: 'OPENCLAW_STATE_DIR', defaultDirName: '.openclaw', discover: plainDiscovery(['skills']) },
  // augment：用户级 ~/.augment/skills 优先级最高；也读 ~/.claude/skills 与 ~/.agents/skills，
  // 后两者分别由 claude-code / shared 承载。官方未提供配置根环境变量。
  augment: { envVar: 'AUGMENT_DIR', defaultDirName: '.augment', discover: plainDiscovery(['skills']) },
  // kimi-code：用户级 $KIMI_CODE_HOME/skills（默认 ~/.kimi-code/skills）。这里刻意用
  // nexus 侧 KIMI_CODE_DIR 而不是 KIMI_CODE_HOME：后者是数据根（含会话、日志、OAuth
  // 凭证），官方支持多实例共享同一数据根，按它建的链接在隔离实例销毁后会悬空。
  // 默认钉在真实 home，需要跟随时用 --source-dir 或 KIMI_CODE_DIR。
  // ~/.agents/skills 在真实 home 下不受 KIMI_CODE_HOME 影响，由 shared 承载。
  // 顶层扁平 .md 技能不纳管——本契约只认目录 + SKILL.md。
  'kimi-code': { envVar: 'KIMI_CODE_DIR', defaultDirName: '.kimi-code', discover: plainDiscovery(['skills']) },
  // windsurf：全局 ~/.codeium/windsurf/skills。产品已并入 Devin Desktop，官方同时列
  // ~/.config/devin/skills（与 Devin CLI 共享）；本来源只取前者，后者留作未来独立来源。
  windsurf: { envVar: 'WINDSURF_DIR', defaultDirName: '.codeium/windsurf', discover: plainDiscovery(['skills']) },
}

/** 已支持的来源标识，用于帮助、错误提示和补全。 */
export const SUPPORTED_SOURCES = Object.keys(SOURCE_CONFIGS)

function sourceConfig(source: string): SourceConfig {
  if (!Object.hasOwn(SOURCE_CONFIGS, source)) {
    throw new LinkError(
      'resolve-failed',
      `unknown link source "${source}" — supported sources: ${SUPPORTED_SOURCES.join(', ')}.`,
    )
  }
  return SOURCE_CONFIGS[source]!
}

/* ------------------------------------------------------------------ */
/* Error dialect                                                        */
/* ------------------------------------------------------------------ */

/** Machine-readable codes for link-channel failures (§10.4 dialect). */
export type LinkErrorCode =
  | 'not-found'
  | 'not-a-skill-dir'
  | 'already-exists'
  | 'resolve-failed'
  | 'name-collision'

/** A link-channel operation was refused or failed. */
export class LinkError extends Error {
  readonly code: LinkErrorCode
  constructor(code: LinkErrorCode, message: string) {
    super(message)
    this.name = 'LinkError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Options accepted by `planLinkLocal` and `linkLocal`. */
export interface LinkOptions {
  /** 覆盖来源根目录；优先于兼容别名和环境变量。 */
  dirOverride?: string
  /** dirOverride 的兼容别名，保留已有调用方式。 */
  traeCnDir?: string
  /** 覆盖 L1 组名，默认使用来源标识。 */
  group?: string
  /** Bypass name-collision checks and overwrite existing entries. */
  force?: boolean
}

/** 从任意已配置来源发现的技能。 */
export interface DiscoveredSkill {
  /**
   * 来源内的分组段，构成 `groupPath` 的第二段：固定子目录布局下是子目录名
   * （`skills`），插件式布局下是插件名。
   */
  segment: string
  /** Directory name within that segment. */
  name: string
  /** Absolute path to the skill directory. */
  dir: string
  /** Frontmatter `name` field (for display / conflict diagnostics). */
  skillName: string
}

/** One planned entry — what `linkLocal` would create. */
export interface LinkPlanEntry {
  /** Flat management name = `groupPath.join('.')`. */
  name: string
  /** Hierarchical group path, e.g. `['trae-cn', 'skills', 'brainstorming']`. */
  groupPath: string[]
  /** Absolute path to the external skill directory. */
  externalDir: string
  /** Frontmatter skill name (for display). */
  skillName: string
}

/** The full preview — every planned entry plus any name collisions. */
export interface LinkPlan {
  /** 来源标识。 */
  source: string
  /** Entries that would be (or were) created. */
  entries: LinkPlanEntry[]
  /** Names that already exist in the manifest (skipped unless `--force`). */
  conflicts: string[]
}

/** The outcome of a `linkLocal` execution. */
export interface LinkResult {
  /** Flat names that were actually added. */
  added: string[]
  /** Flat names skipped due to conflicts (present even without `--force`). */
  skipped: string[]
}

/* ------------------------------------------------------------------ */
/* resolveSourceRoots                                                 */
/* ------------------------------------------------------------------ */

/**
 * 返回所有存在的候选根目录，保持配置顺序。
 * 优先级：dirOverride > 来源环境变量 > rootCandidates/defaultDirName。
 * 显式覆盖只检查该路径，不回退到默认目录；全部不存在时报 not-found。
 */
export async function resolveSourceRoots(
  source: string,
  opts: { dirOverride?: string } = {},
): Promise<string[]> {
  const config = sourceConfig(source)
  const override = opts.dirOverride ?? process.env[config.envVar]
  const defaults = config.rootCandidates ?? (config.defaultDirName ? [config.defaultDirName] : [])
  const candidates = override !== undefined
    ? [resolve(override)]
    : defaults.map((dir) => resolve(homedir(), dir))
  const roots: string[] = []
  for (const root of new Set(candidates)) {
    try {
      if ((await stat(root)).isDirectory()) roots.push(root)
    } catch {
      // 候选根不存在或不可访问时继续检查后续根。
    }
  }
  if (roots.length === 0) {
    throw new LinkError(
      'not-found',
      `${source} root not found at ${candidates.join(', ')}. ` +
        `Pass --source-dir <dir> or set ${config.envVar} to override.`,
    )
  }
  return roots
}

/* ------------------------------------------------------------------ */
/* discoverTraeCnSkills                                                */
/* ------------------------------------------------------------------ */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/**
 * Read the frontmatter `name` from a SKILL.md file. Returns '' when the file
 * is absent, has no frontmatter, or the name field is missing/empty.
 *
 * Exported for other source modules (`qoder.ts`) so their own layouts can reuse
 * the one frontmatter reader instead of duplicating the regex + YAML handling.
 */
export async function readSkillName(skillFile: string): Promise<string> {
  let raw: string
  try {
    raw = await readFile(skillFile, 'utf8')
  } catch {
    return ''
  }
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return ''
  try {
    const fm = parseYaml(match[1] ?? '')
    if (fm && typeof fm === 'object' && typeof fm.name === 'string') {
      return fm.name.trim()
    }
  } catch {
    // Malformed YAML — degrade to empty.
  }
  return ''
}

/**
 * 按根目录优先级扫描各子目录，仅发现一层包含 SKILL.md 的目录。
 * 相同绝对路径只返回一次；不递归扫描嵌套插件布局。
 */
export async function discoverSkills(
  roots: string[],
  subdirs: readonly string[],
): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    for (const subdir of subdirs) {
      const subdirPath = resolve(root, subdir)
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(subdirPath, { withFileTypes: true })
      } catch {
        // 子目录不存在时静默跳过。
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const dir = join(subdirPath, entry.name)
        if (seen.has(dir)) continue
        const skillFile = join(dir, 'SKILL.md')
        const skillName = await readSkillName(skillFile)
        // 保持原有 SKILL.md 存在性判据。
        try {
          await stat(skillFile)
        } catch {
          continue
        }
        seen.add(dir)
        out.push({ segment: subdir, name: entry.name, dir, skillName })
      }
    }
  }
  return out
}

/** 兼容现有测试和调用者。 */
export async function discoverTraeCnSkills(root: string): Promise<DiscoveredSkill[]> {
  return discoverSkills([root], TRAE_CN_SUBDIRS)
}

/* ------------------------------------------------------------------ */
/* planLinkLocal                                                       */
/* ------------------------------------------------------------------ */

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
export async function planLinkLocal(
  source: string,
  opts: LinkOptions = {},
): Promise<LinkPlan> {
  const config = sourceConfig(source)
  const roots = await resolveSourceRoots(source, { dirOverride: opts.dirOverride ?? opts.traeCnDir })
  const discovered: DiscoveredSkill[] = []
  for (const root of roots) discovered.push(...(await config.discover(root)))
  const manifest = await readManifest()
  const group = opts.group ?? source

  const entries: LinkPlanEntry[] = []
  const conflicts: string[] = []
  const seenNames = new Set<string>()

  for (const d of discovered) {
    const groupPath = [group, d.segment, d.name]
    const name = groupPath.join('.')
    if (seenNames.has(name)) continue
    seenNames.add(name)
    if (manifest.skills.some((s) => s.name === name) && !opts.force) {
      conflicts.push(name)
      continue
    }
    entries.push({ name, groupPath, externalDir: d.dir, skillName: d.skillName })
  }

  return { source, entries, conflicts }
}

/* ------------------------------------------------------------------ */
/* linkLocal                                                           */
/* ------------------------------------------------------------------ */

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
export async function linkLocal(
  source: string,
  opts: LinkOptions = {},
  io: OpsIO = {
    confirm: async () => false,
    progress: () => {},
    emit: () => {},
    error: () => {},
    interactive: false,
  },
): Promise<{ plan: LinkPlan; result: LinkResult }> {
  const plan = await planLinkLocal(source, opts)
  const added: string[] = []
  const skipped: string[] = [...plan.conflicts]

  for (const entry of plan.entries) {
    // Check for filesystem-level collisions (a real directory at the link path).
    if (await hasCollision(entry.name)) {
      io.error(`  ⚠ collision: "${entry.name}" — a real directory exists at the link path\n`)
      skipped.push(entry.name)
      continue
    }

    const skillEntry: SkillEntry = {
      name: entry.name,
      url: `${source}:${entry.groupPath.slice(1).join('/')}`,
      gitUrl: '',
      ref: '',
      ownership: 'external',
      path: entry.externalDir,
      addedAt: new Date().toISOString(),
      externalDir: entry.externalDir,
      groupPath: entry.groupPath,
    }

    // When --force is used, remove the existing entry before adding the new one.
    if (opts.force) {
      await removeEntry(entry.name)
    }

    await addEntry(skillEntry)
    await linkSkill(entry.name, entry.externalDir)
    added.push(entry.name)
  }

  return { plan, result: { added, skipped } }
}

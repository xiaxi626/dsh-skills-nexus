/**
 * 通道 E：trae-cn / trae / qoder / qoder-cn 等本地来源的外部条目核心。
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

/** 固定子目录布局（trae-cn / trae）：逐个子目录扫描一层。 */
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

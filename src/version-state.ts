import { join } from 'node:path'
import { discardLocalChanges, getCurrentBranch, getHeadCommit, restoreCheckout, sanitizeName } from './git.js'
import { ensureDescription, normalizeSkillName } from './frontmatter.js'
import { entryLinks, isLinked, linkSkill, unlinkSkill } from './link.js'
import { readManifest, writeManifest } from './manifest.js'
import { repoDir } from './paths.js'
import { previewSkills } from './resolve.js'
import type { EntryLink } from './link.js'
import type { OpsIO } from './ops-io.js'
import type { ParsedSkill } from './resolve.js'
import type { SkillEntry } from './types.js'

/** 过程内快照：登记字段、实际 HEAD 和实际链接分别保存，不相互猜测。 */
export interface VersionState {
  entry: SkillEntry
  commit: string
  branch?: string
  links: EntryLink[]
}

export async function captureVersionState(entry: SkillEntry): Promise<VersionState> {
  const dest = repoDir(entry.path)
  return {
    entry: { ...entry },
    commit: await getHeadCommit(dest),
    branch: await getCurrentBranch(dest),
    links: await entryLinks(entry),
  }
}

/** 只替换本 entry，保留其他 entry 在此期间写入的字段。 */
export async function restoreEntry(entry: SkillEntry): Promise<void> {
  const manifest = await readManifest()
  const index = manifest.skills.findIndex((s) => s.name === entry.name)
  if (index < 0) throw new Error(`Entry "${entry.name}" disappeared during version change`)
  manifest.skills[index] = { ...entry }
  await writeManifest(manifest)
}

export async function normalizeCheckout(entry: SkillEntry, io?: OpsIO): Promise<ParsedSkill[]> {
  const dest = repoDir(entry.path)
  const skills = await previewSkills(entry.subdir ? join(dest, entry.subdir) : dest)
  for (const ps of skills) {
    const name = ps.invalidName ? sanitizeName(ps.invalidName) : (ps.name || entry.name)
    if (ps.invalidName) {
      await normalizeSkillName(ps.skillFile, name)
      io?.emit(`  ⚠ re-normalized name: "${ps.invalidName}" → "${name}"\n`)
    }
    if (!ps.description || ps.description.trim().length === 0) {
      await ensureDescription(ps.skillFile, name)
      io?.emit(`  ⚠ added missing description for "${name}"\n`)
    }
  }
  return skills
}

export async function rebuildVersionLinks(
  state: VersionState,
  skills: ParsedSkill[],
  io?: OpsIO,
): Promise<string[]> {
  const oldNames = new Set(state.links.map((l) => l.name))
  const links = state.links.length === 0 ? [] : skills.map((ps) => ({
    name: skills.length === 1 ? state.entry.name : (ps.invalidName ? sanitizeName(ps.invalidName) : ps.name) || state.entry.name,
    target: ps.resourceBase,
  }))
  // 不覆盖其他 entry 或用户文件；否则仅恢复本 entry 无法闭环。
  for (const l of links) {
    if (!oldNames.has(l.name) && await isLinked(l.name)) {
      throw new Error(`Link collision: "${l.name}" is not owned by "${state.entry.name}"`)
    }
  }
  for (const l of state.links) await unlinkSkill(l.name)
  for (const l of links) await linkSkill(l.name, l.target)
  const names = [...new Set(links.map((l) => l.name))]
  const dropped = [...oldNames].filter((name) => !names.includes(name))
  if (dropped.length > 0) {
    io?.emit(`  ⚠ dropped ${dropped.length} stale link(s) no longer provided upstream: ${dropped.join(', ')}\n`)
  }
  return names
}

/** 每一项恢复均尝试执行；诊断不替代触发恢复的原始错误。 */
export async function restoreVersionState(state: VersionState): Promise<string[]> {
  const failures: string[] = []
  const attempt = async (stage: string, fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (err) {
      failures.push(`${stage}: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
  // 在恢复 checkout 前记录新链接，避免 Windows 上新目录消失后无法归属。
  let current: EntryLink[] = []
  await attempt('capture links', async () => { current = await entryLinks(state.entry) })
  const dest = repoDir(state.entry.path)
  const checkoutRestored = await attempt('checkout', async () => {
    await discardLocalChanges(dest)
    await restoreCheckout(dest, state.commit, state.branch)
  })
  if (checkoutRestored) await attempt('frontmatter', () => normalizeCheckout(state.entry))
  for (const l of current) await attempt(`unlink ${l.name}`, () => unlinkSkill(l.name))
  for (const l of state.links) await attempt(`link ${l.name}`, () => linkSkill(l.name, l.target))
  await attempt('manifest', () => restoreEntry(state.entry))
  return failures
}

export async function recoverVersionFailure(state: VersionState, error: unknown): Promise<never> {
  const failures = await restoreVersionState(state)
  if (failures.length > 0) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\nRecovery failed: ${failures.join('; ')}`, { cause: error })
  }
  throw error
}

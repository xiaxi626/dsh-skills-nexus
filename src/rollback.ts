import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import {
  assertRollbackRef, createRollbackAnchor, deleteRollbackAnchor, isDirtyWorktree,
  resolveRefCommit, rollbackAnchors, ROLLBACK_REF_PREFIX,
} from './git.js'
import { isLinked, safeRealPath } from './link.js'
import { findEntry, hasGitSource, readManifest } from './manifest.js'
import { NEXUS_HOME, repoDir } from './paths.js'
import { captureVersionState, recoverVersionFailure, restoreVersionState } from './version-state.js'
import type { VersionState } from './version-state.js'
import type { OpsIO } from './ops-io.js'
import type { SkillEntry } from './types.js'

/** commit 是实际 HEAD；entry.commit 保留原 manifest 值，包括原有漂移。 */
export interface RollbackState extends VersionState {
  ref: string
  headType: 'branch' | 'detached'
  locked: boolean
  updatedAt?: string
  enabled: boolean
}

export interface RollbackRecord {
  version: 1
  name: string
  anchorRef: string
  from: RollbackState
  to: RollbackState
}

export const ROLLBACK_CONSUMED_MESSAGE = '恢复点已消费；如需再次前进请使用 update/switch-version'

export function rollbackPath(name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Invalid rollback entry name')
  return join(NEXUS_HOME, 'rollback', `${name}.json`)
}

function recorded(state: VersionState): RollbackState {
  return {
    ...state,
    ref: state.entry.ref,
    headType: state.branch === undefined ? 'detached' : 'branch',
    locked: state.entry.locked ?? false,
    updatedAt: state.entry.updatedAt,
    enabled: state.links.length > 0,
  }
}

/** 唯有版本身份变更产生恢复点；时间戳与归一化不属于版本身份。 */
export function versionChanged(from: VersionState, to: VersionState): boolean {
  return from.commit !== to.commit || from.branch !== to.branch ||
    from.entry.ref !== to.entry.ref || (from.entry.locked ?? false) !== (to.entry.locked ?? false)
}

export interface RollbackStoreIO {
  writeFile: typeof writeFile
  rename: typeof rename
}

/**
 * 发布点是 rename：之前失败不改旧记录/旧 anchor；complete 失败时原子恢复旧记录。
 * complete 成功后才清理旧 anchor，垃圾清理不抛错。
 * 唯一 anchor 保留不可达旧对象；中断至多留下孤立 ref，不覆盖其他候选的 ref。
 */
export async function saveRollbackPoint(
  from: VersionState,
  to: VersionState,
  store: RollbackStoreIO = { writeFile, rename },
  complete: () => void = () => {},
): Promise<void> {
  const path = rollbackPath(from.entry.name)
  let previous: string | undefined
  try { previous = await readFile(path, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const dest = repoDir(from.entry.path)
  const token = randomBytes(16).toString('hex')
  const anchorRef = `${ROLLBACK_REF_PREFIX}${token}`
  const record: RollbackRecord = { version: 1, name: from.entry.name, anchorRef, from: recorded(from), to: recorded(to) }
  await mkdir(join(NEXUS_HOME, 'rollback'), { recursive: true })
  await createRollbackAnchor(dest, anchorRef, from.commit)
  const temporary = `${path}.${token}.tmp`
  let published = false
  try {
    await store.writeFile(temporary, JSON.stringify(record, null, 2) + '\n', 'utf8')
    await store.rename(temporary, path)
    published = true
    complete()
  } catch (err) {
    if (published) {
      // 输出等晚期步骤失败时仍保留旧 anchor，先原子恢复原记录，再让调用方恢复 checkout。
      try {
        if (previous === undefined) await rm(path)
        else {
          await store.writeFile(temporary, previous, 'utf8')
          await store.rename(temporary, path)
        }
      } catch (recovery) {
        throw new Error(`${err instanceof Error ? err.message : String(err)}\nRecovery failed: rollback record: ${String(recovery)}`, { cause: err })
      }
    }
    await rm(temporary, { force: true }).catch(() => {})
    throw err
  }
  await cleanupRollbackAnchors(dest, anchorRef)
}

/** 垃圾清理不能将已发布的恢复点变成一次“失败的操作”。 */
async function cleanupRollbackAnchors(dest: string, keep?: string): Promise<void> {
  try {
    for (const ref of await rollbackAnchors(dest)) {
      if (ref !== keep) await deleteRollbackAnchor(dest, ref)
    }
  } catch {
    // 孤立 ref 无害，下一次成功的版本变更继续清理。
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameMetadata(a: SkillEntry, b: SkillEntry, ignoreVersion = false): boolean {
  const ignored = new Set(['updatedAt', 'locked', ...(ignoreVersion ? ['ref', 'commit'] : [])])
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!ignored.has(key) && a[key as keyof SkillEntry] !== b[key as keyof SkillEntry]) return false
  }
  return ignoreVersion || (a.locked ?? false) === (b.locked ?? false)
}

async function validateState(raw: unknown, entry: SkillEntry): Promise<RollbackState> {
  if (!object(raw) || !object(raw.entry) || !Array.isArray(raw.links) ||
    typeof raw.commit !== 'string' || !/^[a-f0-9]{40,64}$/.test(raw.commit) ||
    typeof raw.ref !== 'string' || typeof raw.enabled !== 'boolean' ||
    (raw.locked !== undefined && typeof raw.locked !== 'boolean') ||
    (raw.updatedAt !== undefined && typeof raw.updatedAt !== 'string')) {
    throw new Error('Invalid rollback state')
  }
  const state = raw as unknown as RollbackState
  if (!sameMetadata(state.entry, entry, true) || state.ref !== state.entry.ref ||
    (state.locked ?? false) !== (state.entry.locked ?? false) || state.updatedAt !== state.entry.updatedAt ||
    state.enabled !== (state.links.length > 0) ||
    (state.headType === 'branch'
      ? typeof state.branch !== 'string' || state.branch.length === 0
      : state.headType !== 'detached' || state.branch !== undefined)) {
    throw new Error('Rollback state does not match entry identity')
  }
  const base = await safeRealPath(repoDir(entry.path))
  const names = new Set<string>()
  for (const link of state.links) {
    if (!object(link) || typeof link.name !== 'string' || typeof link.target !== 'string' ||
      !link.name || /[\\/:\u0000-\u001f]/.test(link.name) || link.name === '.' || link.name === '..' || names.has(link.name)) {
      throw new Error('Invalid rollback link')
    }
    names.add(link.name)
    const target = await safeRealPath(link.target)
    if (target !== base && !target.startsWith(base + sep)) throw new Error('Rollback link escapes clone')
  }
  return { ...state, locked: state.locked ?? false }
}

/** 读取及校验始终先于 dirty 丢弃或 checkout。 */
export async function readRollbackPoint(entry: SkillEntry): Promise<RollbackRecord | undefined> {
  let text: string
  try {
    text = await readFile(rollbackPath(entry.name), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
  const raw: unknown = JSON.parse(text)
  if (!object(raw) || raw.version !== 1 || raw.name !== entry.name || typeof raw.anchorRef !== 'string') {
    throw new Error('Invalid rollback record')
  }
  assertRollbackRef(raw.anchorRef)
  const from = await validateState(raw.from, entry)
  const to = await validateState(raw.to, entry)
  if (await resolveRefCommit(repoDir(entry.path), raw.anchorRef) !== from.commit) {
    throw new Error('Rollback anchor does not match from.commit')
  }
  return { version: 1, name: entry.name, anchorRef: raw.anchorRef, from, to }
}

async function sameLinks(a: VersionState['links'], b: VersionState['links']): Promise<boolean> {
  const canonical = async (links: VersionState['links']): Promise<string[]> =>
    Promise.all(links.map(async (l) => `${l.name}\0${await safeRealPath(l.target)}`))
  const left = (await canonical(a)).sort()
  const right = (await canonical(b)).sort()
  return left.length === right.length && left.every((link, i) => link === right[i])
}

export interface RollbackResult {
  name: string
  status: 'rolled-back'
  fromCommit: string
  toCommit: string
  fromRef: string
  toRef: string
  wasDirty: boolean
  links: string[]
}

/** 单次消费，不生成反向恢复点；调用方持有 per-entry 锁。 */
export async function rollbackEntry(name: string, io: OpsIO): Promise<RollbackResult> {
  const entry = findEntry(await readManifest(), name)
  if (!entry) throw new Error(`No skill named "${name}".`)
  if (!hasGitSource(entry)) throw new Error(`Skill "${name}" has no git source`)
  const record = await readRollbackPoint(entry)
  if (!record) throw new Error(`No rollback point for "${name}"`)
  const current = await captureVersionState(entry)
  if (current.commit !== record.to.commit || current.branch !== record.to.branch ||
    !sameMetadata(current.entry, record.to.entry) || !await sameLinks(current.links, record.to.links)) {
    throw new Error('Rollback refused: current HEAD, manifest or links have drifted from the recovery point')
  }
  const currentNames = new Set(current.links.map((link) => link.name))
  for (const link of record.from.links) {
    if (!currentNames.has(link.name) && await isLinked(link.name)) {
      throw new Error(`Rollback refused: link collision at "${link.name}"`)
    }
  }
  const wasDirty = await isDirtyWorktree(repoDir(entry.path))
  if (wasDirty) io.emit('  ⚠ discarding local changes in nexus-managed clone\n')
  try {
    const failures = await restoreVersionState(record.from)
    if (failures.length > 0) throw new Error(`Rollback failed: ${failures.join('; ')}`)
    // 必须先消费记录，之后才删除 anchor；反向顺序可能留下无锚点的有效记录。
    await rm(rollbackPath(name))
  } catch (err) {
    return recoverVersionFailure(current, err)
  }
  await cleanupRollbackAnchors(repoDir(entry.path))
  return {
    name, status: 'rolled-back', fromCommit: record.to.commit, toCommit: record.from.commit,
    fromRef: record.to.ref, toRef: record.from.ref, wasDirty,
    links: record.from.links.map((l) => l.name),
  }
}

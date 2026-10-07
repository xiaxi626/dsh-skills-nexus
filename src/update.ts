import { discardLocalChanges, getHeadCommit, isDirtyWorktree, pullRepo, resolveRefCommit, restoreCheckout } from './git.js'
import { findEntry, hasGitSource, markUpdated, readManifest } from './manifest.js'
import { repoDir } from './paths.js'
import { NotAGitCloneError, SkillNotFoundError } from './switch-version.js'
import { captureVersionState, normalizeCheckout, rebuildVersionLinks, recoverVersionFailure } from './version-state.js'
import type { OpsIO } from './ops-io.js'

export interface UpdateResult {
  name: string
  ref: string
  before: string
  after: string
  status: 'updated' | 'up-to-date' | 'pinned'
  wasDirty: boolean
  links: string[]
}

/** 单 entry 更新的唯一核心。调用方负责 per-entry 锁、批量和输出封装。 */
export async function updateEntry(name: string, io: OpsIO): Promise<UpdateResult> {
  const entry = findEntry(await readManifest(), name)
  if (!entry) throw new SkillNotFoundError(name)
  if (!hasGitSource(entry)) throw new NotAGitCloneError(name)
  const state = await captureVersionState(entry)
  const dest = repoDir(entry.path)
  const wasDirty = await isDirtyWorktree(dest)
  const before = state.commit
  try {
    if (wasDirty) {
      io.emit('  ⚠ discarding local changes in nexus-managed clone\n')
      await discardLocalChanges(dest)
    }
    let status: UpdateResult['status']
    let summary: string
    if (state.branch === undefined) {
      const want = await resolveRefCommit(dest, entry.ref)
      if (before !== want) {
        await restoreCheckout(dest, want)
        status = 'updated'
        summary = `  ✓ restored to pinned ${want.slice(0, 7)}\n`
      } else {
        status = 'pinned'
        summary = `  ✓ pinned at ${before.slice(0, 7)} — nothing to update\n`
      }
    } else {
      io.progress('pulling', entry.name)
      const pull = () => pullRepo(dest)
      await (io.spin ? io.spin(`pulling ${entry.name}`, pull) : pull())
      const next = await getHeadCommit(dest)
      status = next === before ? 'up-to-date' : 'updated'
      summary = next === before
        ? `  ✓ up to date (${next.slice(0, 7)})\n`
        : `  ✓ ${before.slice(0, 7)} → ${next.slice(0, 7)}\n`
    }
    const after = await getHeadCommit(dest)
    const skills = await normalizeCheckout(entry, io)
    const links = await rebuildVersionLinks(state, skills, io)
    await markUpdated(entry.name, after)
    io.emit(summary)
    return { name: entry.name, ref: entry.ref, before, after, status, wasDirty, links }
  } catch (err) {
    return recoverVersionFailure(state, err)
  }
}

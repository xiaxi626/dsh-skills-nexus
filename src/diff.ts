import { diffRepo, fetchDiffTarget, getCurrentBranch, getHeadCommit } from './git.js'
import { findEntry, hasGitSource, readManifest } from './manifest.js'
import { repoDir } from './paths.js'

/** A successful read-only comparison of one managed entry. */
export interface DiffResult {
  name: string
  fromCommit: string
  toCommit: string
  target: string
  output: string
  stat: boolean
}

export class DiffSkillNotFoundError extends Error {
  constructor(readonly skillName: string) {
    super(`No skill named "${skillName}".`)
    this.name = 'DiffSkillNotFoundError'
  }
}

export class DiffNotAGitCloneError extends Error {
  constructor(readonly skillName: string) {
    super(`Skill "${skillName}" has no git source to compare.`)
    this.name = 'DiffNotAGitCloneError'
  }
}

export class DiffTargetRequiredError extends Error {
  constructor(readonly skillName: string, reason: 'locked' | 'detached') {
    super(
      reason === 'locked'
        ? `Skill "${skillName}" is explicitly locked; provide a branch, tag or commit to compare.`
        : `Skill "${skillName}" has a detached HEAD; provide a branch, tag or commit to compare.`,
    )
    this.name = 'DiffTargetRequiredError'
  }
}

/**
 * Compare one managed checkout with a freshly fetched remote ref without
 * checking it out or rewriting the manifest/link state.
 *
 * Omitting `target` is intentionally narrower than `entry.ref`: only an
 * actually attached branch may supply the remote branch name, and an explicit
 * package lock always requires the caller to name a target. This keeps
 * manifest labels from being mistaken for live Git state.
 */
export async function diffEntry(
  name: string,
  target?: string,
  stat = false,
): Promise<DiffResult> {
  const entry = findEntry(await readManifest(), name)
  if (!entry) throw new DiffSkillNotFoundError(name)
  if (!hasGitSource(entry)) throw new DiffNotAGitCloneError(name)

  const dest = repoDir(entry.path)
  const branch = await getCurrentBranch(dest)
  if (target === undefined && entry.locked === true) {
    throw new DiffTargetRequiredError(name, 'locked')
  }
  if (target === undefined && branch === undefined) {
    throw new DiffTargetRequiredError(name, 'detached')
  }

  const requested = target ?? branch!
  const fromCommit = await getHeadCommit(dest)
  const toCommit = await fetchDiffTarget(dest, requested, {
    exactBranch: target === undefined,
  })
  const output = await diffRepo(dest, fromCommit, toCommit, {
    stat,
    ...(entry.subdir === undefined ? {} : { pathspec: entry.subdir }),
  })

  return { name, fromCommit, toCommit, target: requested, output, stat }
}

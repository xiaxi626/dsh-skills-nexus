import { findEntry, hasGitSource, markUpdated, readManifest } from './manifest.js'
import { repoDir } from './paths.js'
import {
  checkoutBranch,
  checkoutRef,
  discardLocalChanges,
  fetchRepo,
  getHeadCommit,
  isDirtyWorktree,
  resolveSwitchTarget,
} from './git.js'
import { captureVersionState, normalizeCheckout, rebuildVersionLinks, recoverVersionFailure } from './version-state.js'
import type { OpsIO } from './ops-io.js'
import { saveRollbackPoint, versionChanged } from './rollback.js'

/**
 * `switch-version` — move an entry's clone to another branch / tag / commit
 * and rebuild everything derived from the checkout (§8.2, seven steps +
 * rollback):
 *
 *   1. record the old link set and the old checkout (what a rollback restores)
 *   2. fetch — a `--depth 1` clone holds no other refs/tags locally
 *   3. resolve + verify the target; a missing ref leaves the clone untouched
 *   4. discard drift, then check out the target
 *   5. re-normalize frontmatter (the checkout restored raw upstream files)
 *   6. drop the old links, create the new set (names may have changed)
 *   7. record the new commit + ref (`refType` is a transient hint, never stored)
 *
 * Design deviation (§6.3 lists `src/git.ts` for `switchVersion`): the
 * orchestration lives in this module so `git.ts` stays a pure git-primitive
 * layer — the steps above also touch the manifest, symlinks and frontmatter,
 * which `git.ts` must not depend on.
 */

/** The manifest has no entry under this name. */
export class SkillNotFoundError extends Error {
  readonly skillName: string
  constructor(skillName: string) {
    super(`No skill named "${skillName}".`)
    this.name = 'SkillNotFoundError'
    this.skillName = skillName
  }
}

/**
 * The requested ref could not be resolved — neither freshly fetched nor
 * already present locally. Thrown before any state change (§8.2 step 3).
 */
export class RefNotFoundError extends Error {
  readonly ref: string
  constructor(ref: string) {
    super(`Ref "${ref}" was not found — nothing was changed.`)
    this.name = 'RefNotFoundError'
    this.ref = ref
  }
}

/** Entries without a git source have no history to switch (→ 400 not-a-git-clone). */
export class NotAGitCloneError extends Error {
  readonly skillName: string
  constructor(skillName: string) {
    super(
      `Skill "${skillName}" has no git source — ` +
        `version switching requires a git clone.`,
    )
    this.name = 'NotAGitCloneError'
    this.skillName = skillName
  }
}

/** Outcome of a successful {@link switchVersion}. */
export interface SwitchVersionResult {
  name: string
  /** The ref that was switched to. */
  ref: string
  /** Commit before the switch. */
  before: string
  /** Commit after the switch (the resolved target commit). */
  after: string
  /** How the clone ended up: aligned local branch vs detached pin. */
  kind: 'branch' | 'pin'
  /** True when local drift was discarded before the checkout. */
  wasDirty: boolean
  /** Link names after the rebuild (empty when the entry is disabled). */
  links: string[]
}

/**
 * Switch the entry's clone to `ref` and rebuild the derived state.
 *
 * `refType` is the caller's hint (branch vs tag/commit, §8.2): the checkout
 * style actually follows what the fetch landed; the hint only orders the
 * offline fallback when nothing could be fetched. It is never persisted.
 */
export async function switchVersion(
  name: string,
  ref: string,
  refType: 'branch' | 'tag' | 'commit' | undefined,
  io: OpsIO,
): Promise<SwitchVersionResult> {
  const manifest = await readManifest()
  const entry = findEntry(manifest, name)
  if (!entry) throw new SkillNotFoundError(name)
  if (!hasGitSource(entry)) throw new NotAGitCloneError(name)

  const dest = repoDir(entry.path)

  // 1 — record the old link set and the old checkout before any mutation:
  //     together they are what a failed switch rolls back to.
  const state = await captureVersionState(entry)
  const before = state.commit

  // 2 — fetch. Mandatory for shallow clones: `--depth 1` holds no other
  //     refs/tags locally, so `git checkout <tag>` without this fails.
  io.progress('fetching', ref)
  const landed = await fetchRepo(dest, ref)

  // 3 — resolve + verify. Nothing has been mutated yet (only remote refs
  //     were updated), so a missing ref leaves the clone untouched.
  const target = await resolveSwitchTarget(dest, ref, landed, refType)
  if (!target) throw new RefNotFoundError(ref)

  const wasDirty = await isDirtyWorktree(dest)

  let after: string
  let links: string[]
  try {
    // 4 — discard drift (install-time normalization rewrites SKILL.md, so a
    //     managed clone is typically dirty), then check out the target.
    if (wasDirty) {
      io.emit('  ⚠ discarding local changes in nexus-managed clone\n')
      await discardLocalChanges(dest)
    }
    if (target.kind === 'branch') {
      await checkoutBranch(dest, ref)
    } else {
      await checkoutRef(dest, target.commit)
    }
    after = await getHeadCommit(dest)

    // 5 — re-normalize frontmatter: the checkout restored raw upstream files
    //     (same install-time convention as `add` / `update`).
    const skills = await normalizeCheckout(entry)

    // 6 — rebuild links. Drop the old set first: names may repeat across the
    //     switch, and a new link created before the old one were removed
    //     would be deleted by the cleanup. Only rebuild when the entry was
    //     linked — a disabled entry must not be silently re-enabled.
    links = await rebuildVersionLinks(state, skills)

    // 7 — record the new version; `refType` is a transient hint, never stored.
    await markUpdated(entry.name, after, ref, false)
    const updated = findEntry(await readManifest(), entry.name)
    if (!updated) throw new Error('Switched entry disappeared')
    const next = await captureVersionState(updated)
    if (versionChanged(state, next)) await saveRollbackPoint(state, next)
  } catch (err) {
    return recoverVersionFailure(state, err)
  }

  return { name: entry.name, ref, before, after, kind: target.kind, wasDirty, links }
}

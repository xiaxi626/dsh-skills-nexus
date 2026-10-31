import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { OpsIO } from '../src/ops-io.js'
import { DANGLING_LINKS_OBSERVABLE, removeTree } from './fs-helpers.js'

/**
 * Integration tests for the health-check module (`src/health.ts`).
 *
 * Exercises real filesystem symlinks — same pattern as test/link.test.ts.
 * DSH_HOME is pointed at a temp dir before importing the module chain.
 */

let home: string
let health: typeof import('../src/health.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-health-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  health = await import('../src/health.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await removeTree(home)
  delete process.env.DSH_HOME
})

function makeEntry(repoPath: string, name = repoPath): SkillEntry {
  return {
    name,
    url: `github:owner/${repoPath}#main`,
    gitUrl: `https://github.com/owner/${repoPath}.git`,
    ref: 'main',
    path: repoPath,
    addedAt: new Date().toISOString(),
  }
}

/** Create a real repo directory with a SKILL.md inside. */
async function makeRepoDir(repoPath: string, subdir?: string): Promise<string> {
  const dir = subdir ? join(paths.repoDir(repoPath), subdir) : paths.repoDir(repoPath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n', 'utf8')
  return dir
}

/** Create a symlink in the official skills root. */
async function makeLink(skillName: string, target: string): Promise<void> {
  await mkdir(paths.OFFICIAL_SKILLS_DIR, { recursive: true })
  const linkPath = paths.skillLinkPath(skillName)
  await symlink(target, linkPath, 'junction')
}

/* ------------------------------------------------------------------ */
/* diagnoseEntry tests                                                 */
/* ------------------------------------------------------------------ */

test('diagnoseEntry returns ok when symlink target exists', async () => {
  const repoPath = 'healthy-repo'
  const targetDir = await makeRepoDir(repoPath)
  await makeLink('healthy-skill', targetDir)

  const entry = makeEntry(repoPath, 'healthy-skill')
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'ok')
})

test('diagnoseEntry returns disabled when no symlink points to the entry', async () => {
  const entry = makeEntry('nonexistent-repo', 'ghost-skill')
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'disabled')
})

/**
 * A link whose target has been deleted is not *identifiable* as a link on
 * Windows: a junction with a missing target is refused by `realpath` (ENOENT)
 * and by `readlink` (EINVAL), while `lstat` reports an ordinary directory. The
 * three tests below ask the code to classify exactly that situation, so they
 * self-skip where the platform cannot express it rather than asserting a
 * classification no filesystem call could have reached.
 *
 * `src/link.ts`'s removal path does not depend on this: `rmdir` removes such a
 * link on every platform (see `test/link.test.ts`).
 */
const DANGLING_LINK_OPAQUE = !DANGLING_LINKS_OBSERVABLE

test('diagnoseEntry returns missing-target when symlink points to deleted directory', { skip: DANGLING_LINK_OPAQUE && 'platform hides a dangling link from realpath/readlink/lstat' }, async () => {
  const repoPath = 'broken-repo'
  const targetDir = await makeRepoDir(repoPath)
  await makeLink('broken-skill', targetDir)

  // Delete the target directory to simulate a broken link
  await rm(targetDir, { recursive: true, force: true })

  const entry = makeEntry(repoPath, 'broken-skill')
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'missing-target')
})

test('diagnoseEntry returns ok when subdir symlink target exists', async () => {
  const repoPath = 'collection-repo'
  const subdir = join('skills', 'foo')
  const targetDir = await makeRepoDir(repoPath, subdir)
  await makeLink('foo-skill', targetDir)

  const entry = makeEntry(repoPath, 'foo-skill')
  entry.subdir = subdir
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'ok')
})

test('diagnoseEntry returns disabled when skills root does not exist', async () => {
  // Use a fresh DSH_HOME with no skills/ directory
  const freshHome = await mkdtemp(join(tmpdir(), 'nexus-health-fresh-'))
  const origHome = process.env.DSH_HOME

  try {
    // We can't re-import paths.ts, but diagnoseEntry reads OFFICIAL_SKILLS_DIR
    // which was captured at import time. So this test verifies behavior when
    // readdir on the skills root succeeds but finds nothing relevant.
    const entry = makeEntry('totally-unknown-repo', 'unknown')
    const result = await health.diagnoseEntry(entry)
    assert.equal(result, 'disabled')
  } finally {
    process.env.DSH_HOME = origHome
    await rm(freshHome, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* checkHealth tests                                                   */
/* ------------------------------------------------------------------ */

test('checkHealth returns empty array when manifest is empty', async () => {
  // Write an empty manifest
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  await writeFile(
    paths.MANIFEST_PATH,
    JSON.stringify({ version: 1, skills: [] }),
    'utf8',
  )

  const issues = await health.checkHealth()
  assert.deepEqual(issues, [])
})

test('checkHealth detects missing-target and excludes disabled entries', { skip: DANGLING_LINK_OPAQUE && 'platform hides a dangling link from realpath/readlink/lstat' }, async () => {
  // Set up: one healthy, one broken, one disabled
  const healthyPath = 'check-healthy'
  const brokenPath = 'check-broken'

  const healthyDir = await makeRepoDir(healthyPath)
  await makeLink('check-healthy-skill', healthyDir)

  const brokenDir = await makeRepoDir(brokenPath)
  await makeLink('check-broken-skill', brokenDir)
  await rm(brokenDir, { recursive: true, force: true })

  // Write manifest with three entries
  const skills = [
    makeEntry(healthyPath, 'check-healthy-skill'),
    makeEntry(brokenPath, 'check-broken-skill'),
    makeEntry('never-linked-repo', 'disabled-skill'),
  ]
  await writeFile(
    paths.MANIFEST_PATH,
    JSON.stringify({ version: 1, skills }),
    'utf8',
  )

  const issues = await health.checkHealth()
  assert.equal(issues.length, 1)
  assert.equal(issues[0]!.name, 'check-broken-skill')
  assert.equal(issues[0]!.issue, 'missing-target')
})

test('checkHealth returns empty when manifest file does not exist', async () => {
  // Remove manifest
  await rm(paths.MANIFEST_PATH, { force: true })

  const issues = await health.checkHealth()
  assert.deepEqual(issues, [])
})

/* ------------------------------------------------------------------ */
/* formatWarning tests                                                 */
/* ------------------------------------------------------------------ */

test('formatWarning returns empty string for no issues', () => {
  assert.equal(health.formatWarning([]), '')
})

test('formatWarning formats single issue with specific repair command', () => {
  const result = health.formatWarning([{ name: 'my-skill', issue: 'missing-target' }])
  assert.ok(result.includes('[nexus] Warning: 1 skill has a broken symlink:'))
  assert.ok(result.includes('- my-skill (symlink points to missing directory)'))
  assert.ok(result.includes('dsh-skills-nexus update my-skill'))
})

test('formatWarning formats multiple issues with generic repair hint', () => {
  const result = health.formatWarning([
    { name: 'alpha', issue: 'missing-target' },
    { name: 'beta', issue: 'missing-target' },
  ])
  assert.ok(result.includes('[nexus] Warning: 2 skills have broken symlinks:'))
  assert.ok(result.includes('- alpha (symlink points to missing directory)'))
  assert.ok(result.includes('- beta (symlink points to missing directory)'))
  assert.ok(result.includes('dsh-skills-nexus update <name>'))
})

/* ------------------------------------------------------------------ */
/* Orphan detection tests (findOrphanRepos / findOrphanLinks)          */
/* ------------------------------------------------------------------ */

/** Wipe repos/ and the skills root so each orphan test starts clean. */
async function resetDirs(): Promise<void> {
  await rm(paths.REPOS_DIR, { recursive: true, force: true })
  await removeTree(paths.OFFICIAL_SKILLS_DIR)
}

test('findOrphanRepos flags clone dirs no entry references', async () => {
  await resetDirs()
  await makeRepoDir('referenced-repo')
  await makeRepoDir('leftover-repo')
  const orphans = await health.findOrphanRepos([makeEntry('referenced-repo')])
  assert.deepEqual(orphans, ['leftover-repo'])
})

test('findOrphanRepos returns empty when repos/ does not exist', async () => {
  await resetDirs()
  assert.deepEqual(await health.findOrphanRepos([]), [])
})

test('findOrphanLinks reports orphan-link for a valid target no entry claims', async () => {
  await resetDirs()
  const dir = await makeRepoDir('unclaimed-repo')
  await makeLink('unclaimed-skill', dir)
  const links = await health.findOrphanLinks([])
  assert.equal(links.length, 1)
  assert.equal(links[0]!.name, 'unclaimed-skill')
  assert.equal(links[0]!.code, 'orphan-link')
})

test('findOrphanLinks reports dangling-link when the target inside repos/ is gone', { skip: DANGLING_LINK_OPAQUE && 'platform hides a dangling link from realpath/readlink/lstat' }, async () => {
  await resetDirs()
  const dir = await makeRepoDir('ghost-repo')
  await makeLink('ghost-skill', dir)
  await rm(dir, { recursive: true, force: true }) // target gone, link remains
  const links = await health.findOrphanLinks([])
  assert.equal(links.length, 1)
  assert.equal(links[0]!.code, 'dangling-link')
})

test('findOrphanLinks skips a link a live entry claims (no double report)', async () => {
  await resetDirs()
  const dir = await makeRepoDir('claimed-repo')
  await makeLink('claimed-skill', dir)
  const links = await health.findOrphanLinks([makeEntry('claimed-repo', 'claimed-skill')])
  assert.deepEqual(links, [])
})

test('findOrphanLinks ignores symlinks pointing outside repos/', async () => {
  await resetDirs()
  const outside = await mkdtemp(join(tmpdir(), 'nexus-outside-'))
  try {
    await makeLink('user-own-skill', outside)
    const links = await health.findOrphanLinks([])
    assert.deepEqual(links, [])
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* checkUpdates — bounded pool: order + concurrency ceiling            */
/* ------------------------------------------------------------------ */

/**
 * The pool contract for `checkUpdates` (P4-1): per-entry remote checks now run
 * through `mapBounded` at `UPDATE_CHECK_CONCURRENCY` instead of a serial
 * `for … await`. Two things must hold that a serial loop gave for free:
 *   - the result array still tracks manifest order even when lanes finish out
 *     of order (index-assembly, same guarantee as the link scanner);
 *   - no more than `UPDATE_CHECK_CONCURRENCY` checks are ever in flight, so a
 *     big batch never fans out into that many simultaneous `git ls-remote`
 *     child processes / network connections.
 *
 * Both are only observable by injecting the per-entry worker (the git/network
 * named imports cannot be patched), so these go through the `checkEntry` seam
 * with a fake executor rather than real clones — `test/update-pipeline.test.ts`
 * already owns the real-git six-state matrix.
 */

/** One macrotask turn — enough to let the pool advance a lane. */
const tick = (): Promise<void> => new Promise((r) => process.nextTick(r))

/** A quiet OpsIO: the fake executor never reports, so nothing is asserted on it. */
const quietIO: OpsIO = {
  confirm: async () => false,
  progress: () => {},
  emit: () => {},
  error: () => {},
  interactive: false,
}

/** Seed a manifest of `n` git-sourced entries named `upd-00 … upd-(n-1)`. */
async function seedManifest(count: number): Promise<string[]> {
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  const names = Array.from({ length: count }, (_, i) => `upd-${String(i).padStart(2, '0')}`)
  const skills = names.map((name) => makeEntry(name, name))
  await writeFile(paths.MANIFEST_PATH, JSON.stringify({ version: 1, skills }), 'utf8')
  return names
}

test('checkUpdates keeps manifest order even when the bounded pool finishes out of order', async () => {
  const names = await seedManifest(10)
  const visited: string[] = []

  // The per-entry delay shrinks with the index, so the first item started is
  // the last to finish — the exact interleave an index-assembled pool must
  // survive. A completion-ordered array would come back reversed here.
  const results = await health.checkUpdates(undefined, quietIO, async (e, _io) => {
    visited.push(e.name)
    const index = names.indexOf(e.name)
    for (let k = names.length - index; k > 0; k--) await tick()
    return { name: e.name, status: 'current' as const }
  })

  assert.deepEqual(visited.slice().sort(), [...names].sort(), 'every manifest entry was visited')
  assert.deepEqual(
    results.map((r) => r.name),
    names,
    'results track manifest order, not completion order',
  )
})

test('checkUpdates holds at most UPDATE_CHECK_CONCURRENCY checks in flight', async () => {
  assert.equal(health.UPDATE_CHECK_CONCURRENCY, 4, 'the network pool ceiling is the constant 4')
  const count = 10
  assert.ok(
    count > health.UPDATE_CHECK_CONCURRENCY,
    'the batch must exceed the ceiling or the bound proves nothing',
  )

  await seedManifest(count)
  let active = 0
  let peak = 0
  await health.checkUpdates(undefined, quietIO, async (e, _io) => {
    active++
    peak = Math.max(peak, active)
    // Hold the lane long enough that a pool without a real ceiling would let
    // all 10 overlap; several ticks keep the increment/decrement honest.
    for (let k = 0; k < 3; k++) await tick()
    active--
    return { name: e.name, status: 'current' as const }
  })

  assert.ok(peak > 1, 'the pool actually ran concurrently — a serial run proves nothing')
  assert.ok(
    peak <= health.UPDATE_CHECK_CONCURRENCY,
    `observed ${peak} in flight exceeds the ceiling ${health.UPDATE_CHECK_CONCURRENCY}`,
  )
})

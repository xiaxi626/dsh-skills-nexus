import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cloneRepo, getHeadCommit, parseGitSpec } from '../src/git.js'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Tests for the update pipeline: `health.checkUpdates` (network) → the
 * runtime update cache (§5.2) → `manifest.listEntries` (the §7.2 merge).
 *
 * The contract under test is the §7.2 cache-write split: only `behind-remote`
 * and `current` record a comparison result, `unresolved` records an explicit
 * "checked, nothing newer", and `locked` / `absent` / `not-applicable` write
 * nothing — so their `update` stays `null` in the list response rather than
 * "(checked) up to date". Nothing is ever persisted: the cache dies with the
 * process by design, and the manifest must not grow derived fields.
 *
 * All git states are real (`file://` remotes, `--depth 1` clones); the
 * `unresolved` case is a clone whose entry ref does not exist on the remote
 * (`git ls-remote` exits 0 with empty output → `undefined`), which needs no
 * network mocking.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the health→manifest→paths chain
 * (test/update.test.ts pattern).
 */

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ */
/* Fixture helpers                                                     */
/* ------------------------------------------------------------------ */

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(join(dir, file), content, 'utf8')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', message])
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

let home: string
let health: typeof import('../src/health.js')
let cache: typeof import('../src/update-cache.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-updates-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  health = await import('../src/health.js')
  cache = await import('../src/update-cache.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** Collecting OpsIO — no stdout/stderr, records how the core reported. */
interface TestIO extends OpsIO {
  emitted: string[]
  stages: string[]
  errors: string[]
}

function makeIO(): TestIO {
  const emitted: string[] = []
  const stages: string[] = []
  const errors: string[] = []
  return {
    emitted,
    stages,
    errors,
    confirm: async () => false,
    progress: (stage, detail) => {
      stages.push(detail ? `${stage}: ${detail}` : stage)
    },
    emit: (line) => {
      emitted.push(line)
    },
    error: (line) => {
      errors.push(line)
    },
    interactive: false,
  }
}

/** Register a git-sourced entry mirroring `add`'s manifest shape. */
async function register(name: string, src: string, ref: string, commit: string): Promise<void> {
  await manifest.addEntry({
    name,
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref,
    commit,
    path: name,
    addedAt: new Date().toISOString(),
  })
}

/** The remote head of the shared fixture repo — captured in the first test. */
let upstreamSha: string

/* ------------------------------------------------------------------ */
/* update-cache — the runtime cell (§5.2)                              */
/* ------------------------------------------------------------------ */

test('the update cache keeps the last result per name (in-process only)', () => {
  assert.equal(cache.getUpdateStatus('cache-unit'), undefined)

  const first = { hasUpdate: true, latestCommit: 'a'.repeat(40), checkedAt: new Date().toISOString() }
  cache.setUpdateStatus('cache-unit', first)
  assert.deepEqual(cache.getUpdateStatus('cache-unit'), first)

  const second = { hasUpdate: false, latestCommit: null, checkedAt: new Date().toISOString() }
  cache.setUpdateStatus('cache-unit', second)
  assert.deepEqual(cache.getUpdateStatus('cache-unit'), second, 'last write wins')
})

/* ------------------------------------------------------------------ */
/* checkUpdates — the six states and the cache-write split             */
/* ------------------------------------------------------------------ */

test('checkUpdates classifies every git state and fills the cache per §7.2', async () => {
  const src = join(home, 'src-up')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', '# v1\n', 'v1')
  const staleSha = await getHeadCommit(src)
  await git(src, ['tag', 'v1.0.0'])
  await commitFile(src, 'SKILL.md', '# v2\n', 'v2')
  upstreamSha = await getHeadCommit(src)

  // behind — clone at the remote head, manifest still records the stale commit
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), paths.repoDir('behind-skill'))
  await register('behind-skill', src, 'main', staleSha)
  // current — manifest commit matches the remote
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), paths.repoDir('current-skill'))
  await register('current-skill', src, 'main', upstreamSha)
  // locked — detached HEAD (tag pin), version-locked by design
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), paths.repoDir('locked-skill'))
  await register('locked-skill', src, 'v1.0.0', staleSha)
  // absent — registered but never cloned
  await register('absent-skill', src, 'main', upstreamSha)
  // not-applicable — no git source, hence no remote to compare against (§5.3)
  await manifest.addEntry({
    name: 'snap-skill',
    url: 'package:z.zip',
    gitUrl: '',
    ref: '',
    commit: '',
    path: 'snap-skill',
    addedAt: new Date().toISOString(),
  })
  // unresolved — clone exists with an attached HEAD, but the entry ref does
  // not exist on the remote (ls-remote exits 0 with empty output)
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), paths.repoDir('unresolved-skill'))
  await register('unresolved-skill', src, 'ghost-branch', upstreamSha)

  const io = makeIO()
  const results = await health.checkUpdates(undefined, io)

  assert.deepEqual(results, [
    { name: 'behind-skill', status: 'behind-remote', local: staleSha, remote: upstreamSha },
    { name: 'current-skill', status: 'current', local: upstreamSha, remote: upstreamSha },
    { name: 'locked-skill', status: 'locked' },
    { name: 'absent-skill', status: 'absent' },
    { name: 'snap-skill', status: 'not-applicable' },
    { name: 'unresolved-skill', status: 'unresolved' },
  ])
  // Only entries that reached the network comparison announce progress.
  assert.deepEqual(io.stages, [
    'checking updates: behind-skill',
    'checking updates: current-skill',
    'checking updates: unresolved-skill',
  ])

  // Cache writes (§7.2): behind/current record the remote comparison;
  // unresolved records an explicit "checked, nothing newer"…
  const behind = cache.getUpdateStatus('behind-skill')!
  assert.equal(behind.hasUpdate, true)
  assert.equal(behind.latestCommit, upstreamSha)
  assert.equal(new Date(behind.checkedAt).toISOString(), behind.checkedAt, 'checkedAt is an ISO timestamp')

  const current = cache.getUpdateStatus('current-skill')!
  assert.equal(current.hasUpdate, false)
  assert.equal(current.latestCommit, upstreamSha)

  const unresolved = cache.getUpdateStatus('unresolved-skill')!
  assert.equal(unresolved.hasUpdate, false)
  assert.equal(unresolved.latestCommit, null)

  // …while pinned / absent / non-git entries stay out of the cache entirely.
  assert.equal(cache.getUpdateStatus('locked-skill'), undefined)
  assert.equal(cache.getUpdateStatus('absent-skill'), undefined)
  assert.equal(cache.getUpdateStatus('snap-skill'), undefined)
})

test('checkUpdates honors the names filter and keeps manifest order', async () => {
  const io = makeIO()
  assert.deepEqual(await health.checkUpdates([], io), [], 'an empty filter checks nothing')
  assert.deepEqual(await health.checkUpdates(['ghost-name'], io), [])

  // Manifest order wins over the filter order.
  const some = await health.checkUpdates(['current-skill', 'behind-skill'], io)
  assert.deepEqual(some.map((r) => r.name), ['behind-skill', 'current-skill'])
  assert.equal(some[0]!.status, 'behind-remote')
  assert.equal(some[1]!.status, 'current')

  assert.deepEqual(await health.checkUpdates(['locked-skill'], io), [
    { name: 'locked-skill', status: 'locked' },
  ])
})

/* ------------------------------------------------------------------ */
/* listEntries — the §7.2 merge                                        */
/* ------------------------------------------------------------------ */

test('listEntries merges enabled/links (reverse-inferred) and the cached update state', async () => {
  // Self-contained: repopulate the runtime cache, then link one entry so the
  // enabled/disabled split has both sides.
  await health.checkUpdates(undefined, makeIO())
  await link.linkSkill('current-skill', paths.repoDir('current-skill'))

  const list = await manifest.listEntries()
  assert.deepEqual(
    list.map((l) => l.entry.name),
    ['behind-skill', 'current-skill', 'locked-skill', 'absent-skill', 'snap-skill', 'unresolved-skill'],
    'every manifest entry is listed, in manifest order',
  )

  const behind = list[0]!
  assert.equal(behind.enabled, false)
  assert.deepEqual(behind.links, [])
  assert.equal(behind.update?.hasUpdate, true)
  assert.equal(behind.update?.latestCommit, upstreamSha)

  const current = list[1]!
  assert.equal(current.enabled, true, 'enabled is reverse-inferred from the symlink')
  assert.deepEqual(current.links.map((l) => l.name), ['current-skill'])
  assert.equal(current.update?.hasUpdate, false)
  assert.equal(current.update?.latestCommit, upstreamSha)

  // Never-checked states stay null — the cache was never written for them.
  assert.equal(list[2]!.update, null, 'locked')
  assert.equal(list[3]!.update, null, 'absent')
  assert.equal(list[4]!.update, null, 'not-applicable')

  const unresolved = list[5]!
  assert.equal(unresolved.update?.hasUpdate, false)
  assert.equal(unresolved.update?.latestCommit, null)

  // Nothing derived is persisted: no enabled/update fields reach the manifest.
  const raw = await readFile(paths.MANIFEST_PATH, 'utf8')
  assert.equal(raw.includes('"enabled"'), false)
  assert.equal(raw.includes('"update"'), false)
})

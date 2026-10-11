import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Unit tests for the three-layer concurrency controls (`src/locks.ts`, §7.3).
 *
 * DSH_HOME is pointed at a temp dir before importing the module chain (paths.ts
 * captures it at import time). Each test starts from a wiped NEXUS_HOME.
 */

let home: string
let locks: typeof import('../src/locks.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-locks-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  locks = await import('../src/locks.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

beforeEach(async () => {
  await rm(paths.NEXUS_HOME, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ */
/* Layer 3 — cross-process file lock                                   */
/* ------------------------------------------------------------------ */

test('acquire writes a {pid, startedAt} lock file; release removes it', async () => {
  const lock = await locks.acquireSkillFileLock('demo')
  const path = join(paths.LOCKS_DIR, 'demo.lock')
  const body = JSON.parse(await readFile(path, 'utf8')) as { pid: number; startedAt: string }
  assert.equal(body.pid, process.pid)
  assert.ok(!Number.isNaN(Date.parse(body.startedAt)))
  await lock.release()
  await assert.rejects(() => readFile(path, 'utf8'))
})

test('a held (live) lock rejects a second acquire with SkillLockedError', async () => {
  const first = await locks.acquireSkillFileLock('held')
  try {
    await assert.rejects(() => locks.acquireSkillFileLock('held'), locks.SkillLockedError)
    const err = await locks.acquireSkillFileLock('held').catch((e: unknown) => e)
    assert.ok(err instanceof locks.SkillLockedError)
    assert.equal(err.lock.pid, process.pid)
  } finally {
    await first.release()
  }
})

test('a dead-PID lock is reclaimed', async () => {
  await mkdir(paths.LOCKS_DIR, { recursive: true })
  const path = join(paths.LOCKS_DIR, 'dead.lock')
  await writeFile(
    path,
    JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
    'utf8',
  )
  const lock = await locks.acquireSkillFileLock('dead')
  const body = JSON.parse(await readFile(path, 'utf8')) as { pid: number }
  assert.equal(body.pid, process.pid)
  await lock.release()
})

test('an aged lock (live PID, older than LOCK_STALE_MS) is reclaimed', async () => {
  await mkdir(paths.LOCKS_DIR, { recursive: true })
  const path = join(paths.LOCKS_DIR, 'aged.lock')
  const old = new Date(Date.now() - locks.LOCK_STALE_MS - 1000).toISOString()
  await writeFile(path, JSON.stringify({ pid: process.pid, startedAt: old }), 'utf8')
  const lock = await locks.acquireSkillFileLock('aged')
  const body = JSON.parse(await readFile(path, 'utf8')) as { startedAt: string }
  assert.ok(Date.parse(body.startedAt) > Date.parse(old))
  await lock.release()
})

test('an unreadable lock file is reclaimed', async () => {
  await mkdir(paths.LOCKS_DIR, { recursive: true })
  await writeFile(join(paths.LOCKS_DIR, 'garbage.lock'), 'not json', 'utf8')
  const lock = await locks.acquireSkillFileLock('garbage')
  await lock.release()
})

test('lock file names are sanitized against path separators', async () => {
  const lock = await locks.acquireSkillFileLock('../../evil')
  const body = await readFile(join(paths.LOCKS_DIR, '.._.._evil.lock'), 'utf8')
  assert.ok(body.length > 0)
  await lock.release()
})

test('withSkillFileLock releases the lock when fn throws', async () => {
  await assert.rejects(() =>
    locks.withSkillFileLock('throws', async () => {
      throw new Error('boom')
    }),
  )
  const lock = await locks.acquireSkillFileLock('throws') // not blocked
  await lock.release()
})

/* ------------------------------------------------------------------ */
/* Layer 1 — per-skill in-process single flight                        */
/* ------------------------------------------------------------------ */

test('withSkillFlight rejects a concurrent second call (SkillBusyError)', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const first = locks.withSkillFlight('x', async () => {
    await gate
  })
  await assert.rejects(() => locks.withSkillFlight('x', async () => undefined), locks.SkillBusyError)
  release()
  await first
  // After the flight settles the slot is free again.
  await locks.withSkillFlight('x', async () => undefined)
})

test('withSkillFlight re-throws fn errors and clears the slot', async () => {
  await assert.rejects(() =>
    locks.withSkillFlight('y', async () => {
      throw new Error('boom')
    }),
  )
  await locks.withSkillFlight('y', async () => undefined)
})

test('different skills fly independently', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const a = locks.withSkillFlight('a', async () => {
    await gate
  })
  const b = locks.withSkillFlight('b', async () => 'ok')
  assert.equal(await b, 'ok')
  release()
  await a
})

/* ------------------------------------------------------------------ */
/* Layer 2 — global runtime-cache lock                                 */
/* ------------------------------------------------------------------ */

test('withCacheLock serializes its callers', async () => {
  const order: string[] = []
  await Promise.all([
    locks.withCacheLock(async () => {
      order.push('a-start')
      await delay(20)
      order.push('a-end')
    }),
    locks.withCacheLock(async () => {
      order.push('b')
    }),
  ])
  assert.deepEqual(order, ['a-start', 'a-end', 'b'])
})

test('withCacheLock keeps serializing after a failure', async () => {
  await assert.rejects(() =>
    locks.withCacheLock(async () => {
      throw new Error('boom')
    }),
  )
  const order: string[] = []
  await locks.withCacheLock(async () => {
    order.push('still-works')
  })
  assert.deepEqual(order, ['still-works'])
})

/* ------------------------------------------------------------------ */
/* Manifest-level cross-process lock                                   */
/* ------------------------------------------------------------------ */

test('withManifestLock acquires and releases the manifest lock file', async () => {
  await locks.withManifestLock(async () => {
    // While the body runs, the lock file must exist.
    const path = join(paths.LOCKS_DIR, '__manifest__.lock')
    const body = JSON.parse(await readFile(path, 'utf8')) as { pid: number; startedAt: string }
    assert.equal(body.pid, process.pid)
    assert.ok(!Number.isNaN(Date.parse(body.startedAt)))
  })
  // After the body settles, the lock file is gone.
  const path = join(paths.LOCKS_DIR, '__manifest__.lock')
  await assert.rejects(() => readFile(path, 'utf8'))
})

test('withManifestLock returns the body value', async () => {
  const result = await locks.withManifestLock(async () => 42)
  assert.equal(result, 42)
})

test('withManifestLock releases the lock when fn throws', async () => {
  await assert.rejects(() =>
    locks.withManifestLock(async () => {
      throw new Error('manifest-boom')
    }),
  )
  // The lock must be released after a failure — acquiring again must succeed.
  const result = await locks.withManifestLock(async () => 'recovered')
  assert.equal(result, 'recovered')
})

test('withManifestLock retries with backoff then rejects a held lock (bounded retry)', async () => {
  // Hold the lock manually via the lower-level acquire so we can test that a
  // second withManifestLock call finds it held and retries until the budget
  // expires. This avoids relying on withManifestLock for the first acquisition,
  // which would require gate orchestration and is sensitive to filesystem
  // settle timing on Windows. Expect ~3 s runtime (MANIFEST_LOCK_BUDGET_MS).
  const lock = await locks.acquireSkillFileLock('__manifest__')
  try {
    await assert.rejects(
      () => locks.withManifestLock(async () => undefined),
      locks.SkillLockedError,
    )
  } finally {
    await lock.release()
  }
  // After the manual lock is released, withManifestLock works again.
  await locks.withManifestLock(async () => undefined)
})

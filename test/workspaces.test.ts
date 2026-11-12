import { strict as assert } from 'node:assert'
import { mkdir, symlink, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  workspaceRegistryOf,
  listWorkspaces,
  resolveWorkspaceTarget,
  detectProjectRoot,
  type WorkspaceRegistryLike,
} from '../src/workspaces.js'

function fakeRegistry(items: Record<string, unknown>[]): WorkspaceRegistryLike {
  return { list: () => items }
}

test('workspaceRegistryOf returns undefined when ctx has no get()', () => {
  assert.equal(workspaceRegistryOf(undefined), undefined)
  assert.equal(workspaceRegistryOf(null), undefined)
  assert.equal(workspaceRegistryOf({}), undefined)
})

test('workspaceRegistryOf returns undefined when ctx.get() throws or returns non-registry', () => {
  const ctx = { get: () => { throw new Error('nope') } }
  assert.equal(workspaceRegistryOf(ctx), undefined)
  const ctx2 = { get: () => ({ noList: true }) }
  assert.equal(workspaceRegistryOf(ctx2), undefined)
})

test('listWorkspaces normalises each row and fills projectRoot via detectProjectRoot', async () => {
  const root = join(tmpdir(), 'nexus-ws-')
  await mkdir(root, { recursive: true })
  try {
    // simulate a workspace whose path lives inside a git repo
    const gitRoot = join(root, 'a-repo')
    await mkdir(join(gitRoot, '.git'), { recursive: true })
    const wsPath = join(gitRoot, 'packages', 'app')
    await mkdir(wsPath, { recursive: true })

    const rows = await listWorkspaces(fakeRegistry([
      { id: 'ws-1', path: wsPath, title: 'My App' },
      { id: 'ws-2', path: join(root, 'missing') },
    ]))
    assert.equal(rows.length, 2)
    const [a, b] = rows
    assert.equal(a.id, 'ws-1')
    assert.equal(a.title, 'My App')
    assert.equal(a.path, wsPath)
    assert.equal(a.projectRoot, gitRoot)
    assert.equal(a.exists, true)
    assert.equal(b.exists, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detectProjectRoot returns the starting path if no .git ancestor exists', async () => {
  const start = join(tmpdir(), 'nexus-nogit-')
  await mkdir(start, { recursive: true })
  try {
    const root = await detectProjectRoot(start)
    assert.equal(root, start)
  } finally {
    await rm(start, { recursive: true, force: true })
  }
})

test('resolveWorkspaceTarget rejects relative paths and unknown registries', async () => {
  const root = join(tmpdir(), 'nexus-resolve-')
  await mkdir(root, { recursive: true })
  try {
    const reg = fakeRegistry([{ id: 'ws-1', path: join(root, 'repo') }])

    // relative path → invalid-path
    const bad1 = await resolveWorkspaceTarget(reg, 'repo/sub')
    assert.deepEqual(bad1, { ok: false, reason: 'invalid-path' })

    // absolute unregistered → unregistered
    const bad2 = await resolveWorkspaceTarget(reg, join(root, 'other'))
    assert.deepEqual(bad2, { ok: false, reason: 'unregistered' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveWorkspaceTarget rejects workspace whose .dsh is a symlink', { skip: process.platform === 'win32' }, async () => {
  const root = join(tmpdir(), 'nexus-sym-')
  await mkdir(root, { recursive: true })
  try {
    const wsRoot = join(root, 'workspace')
    const fakeDsh = join(root, 'fake-dsh')
    await mkdir(wsRoot, { recursive: true })
    await mkdir(fakeDsh, { recursive: true })
    await symlink(fakeDsh, join(wsRoot, '.dsh'), 'dir')

    const reg = fakeRegistry([{ id: 'ws-1', path: wsRoot }])
    const res = await resolveWorkspaceTarget(reg, wsRoot)
    assert.deepEqual(res, { ok: false, reason: 'unsafe-root' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveWorkspaceTarget returns ok with detected projectRoot for a real workspace', async () => {
  const root = join(tmpdir(), 'nexus-ok-')
  await mkdir(root, { recursive: true })
  try {
    const wsRoot = join(root, 'repo')
    await mkdir(join(wsRoot, '.git'), { recursive: true })
    await mkdir(join(wsRoot, '.dsh'), { recursive: true })

    const reg = fakeRegistry([{ id: 'ws-1', path: wsRoot }])
    const res = await resolveWorkspaceTarget(reg, wsRoot)
    assert.ok(res.ok)
    if (res.ok) assert.equal(res.path, wsRoot)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('listWorkspaces returns empty when registry.list() throws', async () => {
  const reg: WorkspaceRegistryLike = { list: () => { throw new Error('boom') } }
  await assert.rejects(() => listWorkspaces(reg))
})

test('listWorkspaces skips rows missing path and degrades gracefully', async () => {
  const root = join(tmpdir(), 'nexus-skip-')
  await mkdir(root, { recursive: true })
  try {
    const wsPath = join(root, 'good')
    await mkdir(wsPath, { recursive: true })
    const rows = await listWorkspaces(fakeRegistry([
      { id: 'bad' },           // no path → skipped
      { path: wsPath },        // no id → falls back to path
      'string-entry',          // not an object → skipped
    ]))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.path, wsPath)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// keep unused import happy in strict builds
void stat

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Manifest, SkillEntry } from '../src/types.js'

/**
 * manifest round-trips against a real temp DSH_HOME.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set
 * *before* the first import of any module in the paths→manifest chain.
 * node:test's default per-process isolation guarantees a fresh process per
 * test file, which makes this safe.
 */

let home: string
let manifestPath: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')

const entry: SkillEntry = {
  name: 'demo',
  url: 'github:owner/demo',
  gitUrl: 'https://github.com/owner/demo.git',
  ref: 'main',
  path: 'demo',
  addedAt: '2026-01-01T00:00:00.000Z',
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-manifest-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  manifestPath = paths.MANIFEST_PATH
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

test('readManifest returns an empty manifest when missing', async () => {
  const m = await manifest.readManifest()
  assert.deepEqual(m, { version: 1, skills: [] })
})

test('writeManifest + readManifest round-trip', async () => {
  const data: Manifest = { version: 1, skills: [entry] }
  await manifest.writeManifest(data)
  const read = await manifest.readManifest()
  assert.deepEqual(read, data)
})

test('addEntry appends and persists', async () => {
  await manifest.writeManifest({ version: 1, skills: [] })
  await manifest.addEntry(entry)
  const m = await manifest.readManifest()
  assert.equal(m.skills.length, 1)
  assert.equal(m.skills[0]!.name, 'demo')
})

test('addEntry rejects duplicate names', async () => {
  await manifest.writeManifest({ version: 1, skills: [entry] })
  await assert.rejects(manifest.addEntry({ ...entry }), /already registered/)
})

test('addEntry rejects duplicate paths', async () => {
  await manifest.writeManifest({ version: 1, skills: [entry] })
  await assert.rejects(
    manifest.addEntry({ ...entry, name: 'other' }),
    /already used by another skill/,
  )
})

test('findEntry and hasEntry match by name or path', async () => {
  const m: Manifest = { version: 1, skills: [entry] }
  assert.equal(manifest.findEntry(m, 'demo')?.path, 'demo')
  assert.equal(manifest.findEntry(m, 'nope'), undefined)
  assert.equal(manifest.hasEntry(m, 'demo'), true)
  assert.equal(manifest.hasEntry(m, 'demo'), true) // by path (same value)
  assert.equal(manifest.hasEntry(m, 'missing'), false)
})

test('removeEntry deletes and returns the entry', async () => {
  await manifest.writeManifest({ version: 1, skills: [entry] })
  const removed = await manifest.removeEntry('demo')
  assert.equal(removed?.name, 'demo')
  const m = await manifest.readManifest()
  assert.deepEqual(m.skills, [])
})

test('removeEntry on an unknown name returns undefined', async () => {
  await manifest.writeManifest({ version: 1, skills: [] })
  assert.equal(await manifest.removeEntry('nope'), undefined)
})

test('markUpdated stamps an ISO updatedAt', async () => {
  await manifest.writeManifest({ version: 1, skills: [entry] })
  await manifest.markUpdated('demo')
  const m = await manifest.readManifest()
  const stamp = m.skills[0]!.updatedAt
  assert.ok(stamp)
  assert.ok(!Number.isNaN(Date.parse(stamp!)))
})

test('markUpdated stamps updatedAt and the resolved commit', async () => {
  await manifest.writeManifest({ version: 1, skills: [entry] })
  await manifest.markUpdated('demo', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')
  const m = await manifest.readManifest()
  assert.equal(m.skills[0]!.commit, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')
  assert.ok(!Number.isNaN(Date.parse(m.skills[0]!.updatedAt!)))
})

test('markUpdated without a commit leaves an existing commit untouched', async () => {
  await manifest.writeManifest({
    version: 1,
    skills: [{ ...entry, commit: 'a1b2c3d' }],
  })
  await manifest.markUpdated('demo')
  const m = await manifest.readManifest()
  assert.equal(m.skills[0]!.commit, 'a1b2c3d')
})

test('corrupt manifest is backed up and resets to empty', async () => {
  await writeFile(manifestPath, '{ this is not json', 'utf8')
  const m = await manifest.readManifest()
  assert.deepEqual(m, { version: 1, skills: [] })
  const files = await readdir(dirname(manifestPath))
  assert.ok(files.some((f) => f.startsWith('manifest.json.corrupt-')), 'backup created')
})

test('removeSkillDir deletes the cloned directory', async () => {
  const dir = paths.skillDir('demo')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '# s', 'utf8')
  await manifest.removeSkillDir('demo')
  await assert.rejects(stat(dir))
})

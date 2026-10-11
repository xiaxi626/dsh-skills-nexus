import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for the `purge` command and its core (`src/purge.ts`).
 *
 * Each test uses a temporary DSH_HOME (mkdtemp) seeded with the four artifact
 * categories. The `after()` hook cleans up. No real git or manifest operations
 * are needed — purge scans directories and reads the manifest to decide which
 * rollback files are orphaned.
 *
 * paths.ts reads DSH_HOME at import time, so the env var must be set before
 * the first import of the purge→paths chain.
 */

let home: string
let purge: typeof import('../src/purge.js')
let manifest: typeof import('../src/manifest.js')
let purgeCmd: typeof import('../src/cli/commands/purge.js')
let paths: typeof import('../src/paths.js')

/** Capture what an OpsIO-shaped mock received. */
function mockIO() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      interactive: false,
      confirm: () => Promise.resolve(false),
      progress: () => {},
      emit: (line: string) => { out.push(line) },
      error: (line: string) => { err.push(line) },
      spin<T>(_msg: string, fn: () => Promise<T>): Promise<T> { return fn() },
    },
    out: () => out.join(''),
    err: () => err.join(''),
  }
}

/**
 * Set an entry's mtime to the Unix epoch — well outside the 24-hour
 * protection window — so `executePurge` treats it as deletable.
 */
async function backdate(p: string): Promise<void> {
  const epoch = new Date(0)
  await utimes(p, epoch, epoch)
}

/** Backdate every artifact seeded by `seedArtifacts`. */
async function backdateAll(): Promise<void> {
  const nh = paths.NEXUS_HOME
  await backdate(join(nh, 'exports', 'old-export.zip'))
  await backdate(join(nh, 'exports', 'another.zip'))
  await backdate(join(nh, 'manifest.json.corrupt-1234567890'))
  await backdate(join(nh, 'manifest.json.corrupt-9876543210'))
  await backdate(join(nh, 'upload-abc123'))
  await backdate(join(nh, 'rollback', 'deleted-skill.json'))
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-purge-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  purge = await import('../src/purge.js')
  manifest = await import('../src/manifest.js')
  purgeCmd = await import('../src/cli/commands/purge.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** Seed the four artifact categories in the current NEXUS_HOME. */
async function seedArtifacts(): Promise<void> {
  const nh = paths.NEXUS_HOME

  // 1. exports/*.zip
  const exportsDir = join(nh, 'exports')
  await mkdir(exportsDir, { recursive: true })
  await writeFile(join(exportsDir, 'old-export.zip'), 'PK-fake-zip-1')
  await writeFile(join(exportsDir, 'another.zip'), 'PK-fake-zip-2')

  // 2. manifest.json.corrupt-*
  await writeFile(join(nh, 'manifest.json.corrupt-1234567890'), '{broken}')
  await writeFile(join(nh, 'manifest.json.corrupt-9876543210'), '{broken-2}')

  // 3. upload-*
  const uploadDir = join(nh, 'upload-abc123')
  await mkdir(uploadDir, { recursive: true })
  await writeFile(join(uploadDir, 'temp-file'), 'temp-content')

  // 4. rollback/<name>.json — orphan (name not in manifest)
  const rollbackDir = join(nh, 'rollback')
  await mkdir(rollbackDir, { recursive: true })
  await writeFile(join(rollbackDir, 'deleted-skill.json'), '{"name":"deleted-skill"}')
}

test('scanPurgeable finds all four artifact categories', async () => {
  await seedArtifacts()
  // Ensure the manifest is initialised (empty is fine — no skills registered).
  await manifest.readManifest()

  const items = await purge.scanPurgeable()
  const categories = new Set(items.map((i) => i.category))

  assert.ok(categories.has('exports'), 'should find export zips')
  assert.ok(categories.has('corrupt-manifest'), 'should find corrupt manifest backups')
  assert.ok(categories.has('upload-temp'), 'should find upload temp dirs')
  assert.ok(categories.has('orphan-rollback'), 'should find orphan rollback files')

  const exportItems = items.filter((i) => i.category === 'exports')
  assert.equal(exportItems.length, 2, 'should find 2 export zips')

  const corruptItems = items.filter((i) => i.category === 'corrupt-manifest')
  assert.equal(corruptItems.length, 2, 'should find 2 corrupt manifest backups')

  const uploadItems = items.filter((i) => i.category === 'upload-temp')
  assert.equal(uploadItems.length, 1, 'should find 1 upload temp dir')

  const orphanItems = items.filter((i) => i.category === 'orphan-rollback')
  assert.equal(orphanItems.length, 1, 'should find 1 orphan rollback file')

  // Clean up for the next test.
  await rm(join(paths.NEXUS_HOME, 'exports'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-1234567890'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-9876543210'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'upload-abc123'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'rollback'), { recursive: true, force: true })
})

test('scanPurgeable preserves active skill rollback files', async () => {
  // Register a skill so its rollback file is NOT orphaned.
  await manifest.addEntry({
    name: 'active-skill',
    url: 'github:owner/active-skill',
    gitUrl: 'https://github.com/owner/active-skill.git',
    ref: 'main',
    path: 'active-skill',
    addedAt: new Date().toISOString(),
  })

  const rollbackDir = join(paths.NEXUS_HOME, 'rollback')
  await mkdir(rollbackDir, { recursive: true })
  await writeFile(join(rollbackDir, 'active-skill.json'), '{"name":"active-skill"}')
  await writeFile(join(rollbackDir, 'gone-skill.json'), '{"name":"gone-skill"}')

  const items = await purge.scanPurgeable()
  const orphanItems = items.filter((i) => i.category === 'orphan-rollback')

  assert.equal(orphanItems.length, 1, 'only the orphan should be purgeable')
  assert.ok(
    orphanItems[0]!.path.endsWith('gone-skill.json'),
    'the orphan should be gone-skill, not active-skill',
  )

  // Clean up.
  await manifest.removeEntry('active-skill')
  await rm(rollbackDir, { recursive: true, force: true })
})

test('executePurge removes all items and reports what was deleted', async () => {
  await seedArtifacts()
  await manifest.readManifest()
  // Fresh artifacts have current mtime — backdate so the guard allows deletion.
  await backdateAll()

  const items = await purge.scanPurgeable()
  assert.ok(items.length > 0, 'should have items to purge')

  const result = await purge.executePurge(items)
  assert.equal(result.removed.length, items.length, 'all items should be removed')
  assert.equal(result.skippedRecent.length, 0, 'no items should be skipped')

  // A second scan should find nothing.
  const remaining = await purge.scanPurgeable()
  assert.equal(remaining.length, 0, 'nothing should remain after purge')
})

test('executePurge spares items with recent mtime', async () => {
  await seedArtifacts()
  await manifest.readManifest()
  // Do NOT backdate — all items have current mtime, inside the guard window.

  const items = await purge.scanPurgeable()
  assert.ok(items.length > 0, 'should have items to purge')

  const result = await purge.executePurge(items)
  assert.equal(result.removed.length, 0, 'no fresh items should be removed')
  assert.equal(result.skippedRecent.length, items.length, 'all fresh items should be skipped')

  // Items should still exist — the mtime guard spared them.
  const remaining = await purge.scanPurgeable()
  assert.equal(remaining.length, items.length, 'all items should survive the mtime guard')

  // Clean up.
  await rm(join(paths.NEXUS_HOME, 'exports'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-1234567890'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-9876543210'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'upload-abc123'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'rollback'), { recursive: true, force: true })
})

test('purge CLI dry-run does not delete files', async () => {
  await seedArtifacts()
  await manifest.readManifest()

  const { io, out } = mockIO()
  const code = await purgeCmd.purge([], io)
  assert.equal(code, 0, 'dry-run should exit 0')
  assert.match(out(), /Found \d+ artifact/, 'dry-run should report artifact count')
  assert.match(out(), /Dry run/, 'dry-run should say it is a dry run')

  // Files should still exist.
  const items = await purge.scanPurgeable()
  assert.ok(items.length > 0, 'artifacts should survive a dry-run')

  // Clean up.
  await rm(join(paths.NEXUS_HOME, 'exports'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-1234567890'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-9876543210'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'upload-abc123'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'rollback'), { recursive: true, force: true })
})

test('purge CLI --yes deletes all artifacts', async () => {
  await seedArtifacts()
  await manifest.readManifest()
  // Backdate so the mtime guard allows actual deletion.
  await backdateAll()

  const { io, out } = mockIO()
  const code = await purgeCmd.purge(['--yes'], io)
  assert.equal(code, 0, '--yes should exit 0')
  assert.match(out(), /Purged \d+ artifact/, '--yes should report purged count')

  const remaining = await purge.scanPurgeable()
  assert.equal(remaining.length, 0, 'nothing should remain after --yes')
})

test('purge CLI --json dry-run emits a JSON report', async () => {
  await seedArtifacts()
  await manifest.readManifest()

  const { io, out } = mockIO()
  const code = await purgeCmd.purge(['--json'], io)
  assert.equal(code, 0)

  const report = JSON.parse(out())
  assert.equal(report.version, 1)
  assert.ok(Array.isArray(report.files))
  assert.ok(report.files.length > 0, 'JSON report should list files')
  assert.equal(report.removed, 0, 'dry-run JSON should report 0 removed')
  assert.ok(report.totalSize > 0, 'totalSize should be positive')

  // Clean up.
  await rm(join(paths.NEXUS_HOME, 'exports'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-1234567890'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'manifest.json.corrupt-9876543210'), { force: true })
  await rm(join(paths.NEXUS_HOME, 'upload-abc123'), { recursive: true, force: true })
  await rm(join(paths.NEXUS_HOME, 'rollback'), { recursive: true, force: true })
})

test('purge CLI --json --yes reports what was removed', async () => {
  await seedArtifacts()
  await manifest.readManifest()
  // Backdate so the mtime guard allows actual deletion.
  await backdateAll()

  const { io, out } = mockIO()
  const code = await purgeCmd.purge(['--yes', '--json'], io)
  assert.equal(code, 0)

  const report = JSON.parse(out())
  assert.equal(report.version, 1)
  assert.ok(report.removed > 0, '--yes --json should report removed count > 0')
  assert.equal(report.files.length, report.removed, 'files array length should match removed')
})

test('purge CLI empty directory does not error', async () => {
  // No artifacts seeded — DSH_HOME has only the manifest.
  await manifest.readManifest()

  const { io, out } = mockIO()
  const code = await purgeCmd.purge([], io)
  assert.equal(code, 0, 'empty purge should exit 0')
  assert.match(out(), /Nothing to purge/, 'should say nothing to purge')
})

test('purge CLI unknown argument is a usage error', async () => {
  const { io, err } = mockIO()
  const code = await purgeCmd.purge(['--nope'], io)
  assert.equal(code, 2, 'unknown flag should exit 2')
  assert.match(err(), /unknown argument/, 'should explain the usage error')
})

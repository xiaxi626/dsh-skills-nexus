import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Integration tests for the batch / wildcard `remove` command.
 *
 * Entries are seeded directly via manifest.addEntry (no real clone needed):
 * removeOne tolerates a missing clone dir (previewSkills throws → caught →
 * removeSkillDir is a forced no-op), so these tests focus on the batch loop,
 * glob expansion, the multi-match guard, and exit codes.
 *
 * paths.ts reads DSH_HOME at import time, so the env var must be set before the
 * first import of the manifest→paths chain (same pattern as add.test.ts). The
 * node:test runner is non-TTY, so the multi-match guard deterministically takes
 * its "refuse without --yes" branch (exit 2) — the same non-TTY assumption the
 * large-collection test in add.test.ts already relies on.
 */

let home: string
let remove: typeof import('../src/cli/commands/remove.js')
let manifest: typeof import('../src/manifest.js')

async function names(): Promise<string[]> {
  return (await manifest.readManifest()).skills.map((s) => s.name)
}

/** Reset the manifest to exactly `seedNames`. */
async function reset(...seedNames: string[]): Promise<void> {
  for (const n of await names()) await manifest.removeEntry(n)
  for (const name of seedNames) {
    await manifest.addEntry({
      name,
      url: `github:owner/${name}`,
      gitUrl: `https://github.com/owner/${name}.git`,
      ref: 'main',
      path: name,
      addedAt: new Date().toISOString(),
    })
  }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-remove-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  remove = await import('../src/cli/commands/remove.js')
  manifest = await import('../src/manifest.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Exact-name removal (unchanged single-target behavior)               */
/* ------------------------------------------------------------------ */

test('remove deletes a single exact name and returns 0', async () => {
  await reset('alpha')
  assert.equal(await remove.remove(['alpha']), 0)
  assert.deepEqual(await names(), [])
})

test('remove of an unregistered name returns 1 and touches nothing', async () => {
  await reset('alpha')
  assert.equal(await remove.remove(['nope']), 1)
  assert.deepEqual(await names(), ['alpha'])
})

test('remove with no arguments is a usage error (exit 2)', async () => {
  await reset('alpha')
  assert.equal(await remove.remove([]), 2)
  assert.deepEqual(await names(), ['alpha'])
})

/* ------------------------------------------------------------------ */
/* Batch (multiple names in one call)                                  */
/* ------------------------------------------------------------------ */

test('remove accepts multiple names in one call', async () => {
  await reset('alpha', 'beta', 'gamma')
  assert.equal(await remove.remove(['alpha', 'beta']), 0)
  assert.deepEqual(await names(), ['gamma'])
})

test('remove with one missing name is a partial failure (exit 1); the rest are removed', async () => {
  await reset('alpha', 'beta')
  assert.equal(await remove.remove(['alpha', 'missing', 'beta']), 1)
  assert.deepEqual(await names(), [])
})

/* ------------------------------------------------------------------ */
/* Wildcard (glob) removal + multi-match guard                         */
/* ------------------------------------------------------------------ */

test('remove expands a * glob with --yes and deletes the whole family', async () => {
  await reset('theme-dark', 'theme-light', 'editor-vim')
  assert.equal(await remove.remove(['theme-*', '--yes']), 0)
  assert.deepEqual(await names(), ['editor-vim'])
})

test('remove expands a ? glob with --yes (single character only)', async () => {
  await reset('skill-1', 'skill-2', 'skill-10')
  assert.equal(await remove.remove(['skill-?', '--yes']), 0)
  assert.deepEqual(await names(), ['skill-10'])
})

test('a single-match glob needs no --yes (guard only fires on >1 match)', async () => {
  await reset('solo-skill', 'other')
  assert.equal(await remove.remove(['solo-*']), 0)
  assert.deepEqual(await names(), ['other'])
})

test('a multi-match glob without --yes is refused on a non-TTY (exit 2, nothing removed)', async () => {
  await reset('theme-dark', 'theme-light')
  assert.equal(await remove.remove(['theme-*']), 2)
  assert.deepEqual((await names()).sort(), ['theme-dark', 'theme-light'])
})

test('a glob matching nothing is a per-item failure (exit 1)', async () => {
  await reset('alpha')
  assert.equal(await remove.remove(['zzz*']), 1)
  assert.deepEqual(await names(), ['alpha'])
})

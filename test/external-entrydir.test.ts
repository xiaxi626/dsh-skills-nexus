import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'

/**
 * Tests for `entrySkillDir` — the single read-path resolver.
 *
 * The promise under test is that every read path that used to compute
 * `entry.subdir ? join(repoDir(entry.path), entry.subdir) : repoDir(entry.path)`
 * now calls this single function, which redirects external entries to their
 * `externalDir` instead. Without it, external entries would be invisible to
 * toggle, health, list and link scanning.
 *
 * **Critical equivalence assertion**: for managed entries (with and without
 * subdir), `entrySkillDir(e)` must be byte-for-byte equivalent to the old
 * ternary, so no managed entry regresses.
 */

let home: string
let paths: typeof import('../src/paths.js')
let external: typeof import('../src/external.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-entrydir-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  paths = await import('../src/paths.js')
  external = await import('../src/external.js')
  assert.ok(
    paths.OFFICIAL_SKILLS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.OFFICIAL_SKILLS_DIR}`,
  )
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* entrySkillDir — external entries                                    */
/* ------------------------------------------------------------------ */

test('entrySkillDir returns externalDir for new-style external entries', () => {
  const entry: SkillEntry = {
    name: 'trae-cn.skills.brainstorming',
    url: 'trae-cn:skills/brainstorming',
    gitUrl: '',
    ref: '',
    ownership: 'external',
    path: '/some/other/path', // ignored when externalDir is present
    addedAt: new Date().toISOString(),
    externalDir: '/absolute/path/to/brainstorming',
    groupPath: ['trae-cn', 'skills', 'brainstorming'],
  }

  const result = external.entrySkillDir(entry)
  assert.equal(result, '/absolute/path/to/brainstorming')
})

test('entrySkillDir ignores externalDir for managed entries', () => {
  // Create the repo directory so the path is valid.
  const entry: SkillEntry = {
    name: 'managed-skill',
    url: 'https://example.com/repo',
    gitUrl: 'https://example.com/repo',
    ref: 'main',
    path: 'managed-skill',
    addedAt: new Date().toISOString(),
    externalDir: '/should/be/ignored', // ignored for managed entries
  }

  const result = external.entrySkillDir(entry)
  assert.equal(result, paths.repoDir('managed-skill'))
})

/* ------------------------------------------------------------------ */
/* entrySkillDir — managed entries (critical equivalence assertion)    */
/* ------------------------------------------------------------------ */

test('entrySkillDir: managed entry without subdir → repoDir(entry.path)', () => {
  const entry: SkillEntry = {
    name: 'no-subdir',
    url: 'https://example.com/repo',
    gitUrl: 'https://example.com/repo',
    ref: 'main',
    path: 'no-subdir',
    addedAt: new Date().toISOString(),
  }

  const result = external.entrySkillDir(entry)
  const expected = paths.repoDir('no-subdir')
  assert.equal(result, expected)

  // Critical equivalence: byte-for-byte match with the old ternary.
  const oldTernary = entry.subdir
    ? join(paths.repoDir(entry.path), entry.subdir)
    : paths.repoDir(entry.path)
  assert.equal(result, oldTernary)
})

test('entrySkillDir: managed entry with subdir → join(repoDir(entry.path), subdir)', () => {
  const entry: SkillEntry = {
    name: 'with-subdir',
    url: 'https://example.com/repo',
    gitUrl: 'https://example.com/repo',
    ref: 'main',
    path: 'with-subdir',
    subdir: 'skills/my-skill',
    addedAt: new Date().toISOString(),
  }

  const result = external.entrySkillDir(entry)
  const expected = join(paths.repoDir('with-subdir'), 'skills/my-skill')
  assert.equal(result, expected)

  // Critical equivalence: byte-for-byte match with the old ternary.
  const oldTernary = entry.subdir
    ? join(paths.repoDir(entry.path), entry.subdir)
    : paths.repoDir(entry.path)
  assert.equal(result, oldTernary)
})

/* ------------------------------------------------------------------ */
/* entrySkillDir — old-style external entries (--link-only adopt)      */
/* ------------------------------------------------------------------ */

test('entrySkillDir: old-style external entry (no externalDir) → managed branch', () => {
  // Old-style external entries from `--link-only` adopt have `ownership: 'external'`
  // but no `externalDir`. They should use the managed branch.
  const entry: SkillEntry = {
    name: 'old-external',
    url: 'https://example.com/repo',
    gitUrl: 'https://example.com/repo',
    ref: 'main',
    ownership: 'external',
    path: 'old-external',
    addedAt: new Date().toISOString(),
    // No externalDir — this is the key difference from new-style external entries.
  }

  const result = external.entrySkillDir(entry)
  const expected = paths.repoDir('old-external')
  assert.equal(result, expected)

  // Critical equivalence: byte-for-byte match with the old ternary.
  const oldTernary = entry.subdir
    ? join(paths.repoDir(entry.path), entry.subdir)
    : paths.repoDir(entry.path)
  assert.equal(result, oldTernary)
})

test('entrySkillDir: old-style external entry with subdir → managed branch with subdir', () => {
  const entry: SkillEntry = {
    name: 'old-external-subdir',
    url: 'https://example.com/repo',
    gitUrl: 'https://example.com/repo',
    ref: 'main',
    ownership: 'external',
    path: 'old-external-subdir',
    subdir: 'skills/nested',
    addedAt: new Date().toISOString(),
    // No externalDir — old-style external entry.
  }

  const result = external.entrySkillDir(entry)
  const expected = join(paths.repoDir('old-external-subdir'), 'skills/nested')
  assert.equal(result, expected)

  // Critical equivalence: byte-for-byte match with the old ternary.
  const oldTernary = entry.subdir
    ? join(paths.repoDir(entry.path), entry.subdir)
    : paths.repoDir(entry.path)
  assert.equal(result, oldTernary)
})

/* ------------------------------------------------------------------ */
/* entrySkillDir — edge cases                                          */
/* ------------------------------------------------------------------ */

test('entrySkillDir: empty subdir is falsy → managed branch without subdir', () => {
  const entry: SkillEntry = {
    name: 'empty-subdir',
    url: 'https://example.com/repo',
    gitUrl: 'https://example.com/repo',
    ref: 'main',
    path: 'empty-subdir',
    subdir: '', // empty string is falsy
    addedAt: new Date().toISOString(),
  }

  const result = external.entrySkillDir(entry)
  const expected = paths.repoDir('empty-subdir')
  assert.equal(result, expected)
})

test('entrySkillDir: externalDir with Windows-style path is returned as-is', () => {
  // On Windows, paths use backslashes. The function should return the path as-is.
  const entry: SkillEntry = {
    name: 'windows-path',
    url: 'trae-cn:skills/windows',
    gitUrl: '',
    ref: '',
    ownership: 'external',
    path: 'C:\\Users\\test\\trae-cn\\skills\\windows',
    addedAt: new Date().toISOString(),
    externalDir: 'C:\\Users\\test\\trae-cn\\skills\\windows',
    groupPath: ['trae-cn', 'skills', 'windows'],
  }

  const result = external.entrySkillDir(entry)
  assert.equal(result, 'C:\\Users\\test\\trae-cn\\skills\\windows')
})

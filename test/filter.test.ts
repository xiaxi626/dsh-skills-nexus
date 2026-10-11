import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesQuery } from '../src/filter.js'

/**
 * Unit tests for the shared `matchesQuery` filter (`src/filter.ts`).
 *
 * The function is pure (no FS, no I/O), so the tests are straightforward
 * input → output assertions. The same function serves both the CLI
 * `list --filter` and the panel's search box, so the fixtures cover both
 * `gitUrl` (CLI `SkillEntry`) and `url` (panel `ListEntry`) shapes.
 */

const entry = {
  name: 'theme-dark',
  gitUrl: 'https://github.com/trae-community/trae-skills.git',
  subdir: 'skills/dark',
}

test('matchesQuery matches on the entry name (case-insensitive)', () => {
  assert.ok(matchesQuery(entry, 'THEME'))
  assert.ok(matchesQuery(entry, 'dark'))
  assert.ok(!matchesQuery(entry, 'light'))
})

test('matchesQuery matches on the git URL', () => {
  assert.ok(matchesQuery(entry, 'trae-community'))
  assert.ok(matchesQuery(entry, 'trae-skills'))
  assert.ok(!matchesQuery(entry, 'gitlab.com'))
})

test('matchesQuery matches on the subdir', () => {
  assert.ok(matchesQuery(entry, 'skills/dark'))
  assert.ok(matchesQuery(entry, 'DARK'))
  assert.ok(!matchesQuery(entry, 'skills/light'))
})

test('matchesQuery with an empty query matches everything', () => {
  assert.ok(matchesQuery(entry, ''))
  assert.ok(matchesQuery(entry, '   '))
})

test('matchesQuery accepts the panel ListEntry shape (url instead of gitUrl)', () => {
  const panelEntry = { name: 'foo', url: 'https://github.com/owner/repo.git', subdir: null }
  assert.ok(matchesQuery(panelEntry, 'owner/repo'))
  assert.ok(matchesQuery(panelEntry, 'foo'))
})

test('matchesQuery handles entries without a subdir', () => {
  const noSubdir = { name: 'solo', gitUrl: 'https://github.com/owner/repo.git' }
  assert.ok(matchesQuery(noSubdir, 'solo'))
  assert.ok(!matchesQuery(noSubdir, 'skills/'))
})

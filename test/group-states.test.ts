import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ListedEntry } from '../src/manifest.js'
import type { GroupState } from '../src/http/routes.js'

/**
 * Tests for `deriveGroupStates` — the function that computes group-level
 * on/off/mixed states from a list of entries with `groupPath`.
 *
 * The panel uses this for the group-level Switch: 'on' = all enabled,
 * 'off' = none enabled, 'mixed' = some enabled.
 */

let routes: typeof import('../src/http/routes.js')

async function loadRoutes(): Promise<void> {
  if (!routes) {
    routes = await import('../src/http/routes.js')
  }
}

function makeListedEntry(
  name: string,
  groupPath: string[] | undefined,
  enabled: boolean,
): ListedEntry {
  return {
    entry: {
      name,
      url: groupPath ? `trae-cn:${groupPath.slice(1).join('/')}` : 'https://example.com',
      gitUrl: '',
      ref: '',
      ownership: groupPath ? 'external' : 'managed',
      path: name,
      addedAt: new Date().toISOString(),
      ...(groupPath ? { groupPath } : {}),
    },
    enabled,
    links: [],
    update: null,
  }
}

/* ------------------------------------------------------------------ */
/* deriveGroupStates — empty input                                     */
/* ------------------------------------------------------------------ */

test('deriveGroupStates returns empty array for empty input', async () => {
  await loadRoutes()
  const result = routes.deriveGroupStates([])
  assert.deepEqual(result, [])
})

/* ------------------------------------------------------------------ */
/* deriveGroupStates — entries without groupPath                       */
/* ------------------------------------------------------------------ */

test('deriveGroupStates ignores entries without groupPath', async () => {
  await loadRoutes()
  const entries = [
    makeListedEntry('no-group-1', undefined, true),
    makeListedEntry('no-group-2', undefined, false),
  ]
  const result = routes.deriveGroupStates(entries)
  assert.deepEqual(result, [])
})

/* ------------------------------------------------------------------ */
/* deriveGroupStates — all enabled → 'on'                              */
/* ------------------------------------------------------------------ */

test('deriveGroupStates returns state "on" when all entries are enabled', async () => {
  await loadRoutes()
  const entries = [
    makeListedEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], true),
    makeListedEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], true),
  ]
  const result = routes.deriveGroupStates(entries)

  // Should have L1 (trae-cn), L2 (trae-cn/skills), L3 (trae-cn/skills/alpha, trae-cn/skills/beta) = 4 total.
  assert.equal(result.length, 4)

  const l1 = result.find((g) => g.path.length === 1 && g.path[0] === 'trae-cn')
  assert.ok(l1)
  assert.equal(l1.state, 'on')
  assert.equal(l1.count, 2)

  const l2 = result.find((g) => g.path.length === 2 && g.path[1] === 'skills')
  assert.ok(l2)
  assert.equal(l2.state, 'on')
  assert.equal(l2.count, 2)
})

/* ------------------------------------------------------------------ */
/* deriveGroupStates — all disabled → 'off'                            */
/* ------------------------------------------------------------------ */

test('deriveGroupStates returns state "off" when no entries are enabled', async () => {
  await loadRoutes()
  const entries = [
    makeListedEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], false),
    makeListedEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], false),
  ]
  const result = routes.deriveGroupStates(entries)

  const l1 = result.find((g) => g.path.length === 1 && g.path[0] === 'trae-cn')
  assert.ok(l1)
  assert.equal(l1.state, 'off')
  assert.equal(l1.count, 2)
})

/* ------------------------------------------------------------------ */
/* deriveGroupStates — some enabled → 'mixed'                          */
/* ------------------------------------------------------------------ */

test('deriveGroupStates returns state "mixed" when some entries are enabled', async () => {
  await loadRoutes()
  const entries = [
    makeListedEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], true),
    makeListedEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], false),
  ]
  const result = routes.deriveGroupStates(entries)

  const l1 = result.find((g) => g.path.length === 1 && g.path[0] === 'trae-cn')
  assert.ok(l1)
  assert.equal(l1.state, 'mixed')
  assert.equal(l1.count, 2)

  const l2 = result.find((g) => g.path.length === 2 && g.path[1] === 'skills')
  assert.ok(l2)
  assert.equal(l2.state, 'mixed')
  assert.equal(l2.count, 2)
})

/* ------------------------------------------------------------------ */
/* deriveGroupStates — multiple L1 groups                              */
/* ------------------------------------------------------------------ */

test('deriveGroupStates handles multiple L1 groups independently', async () => {
  await loadRoutes()
  const entries = [
    makeListedEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], true),
    makeListedEntry('other.skills.beta', ['other', 'skills', 'beta'], false),
  ]
  const result = routes.deriveGroupStates(entries)

  // Should have 2 L1 groups + 2 L2 groups + 2 L3 groups = 6 total.
  assert.equal(result.length, 6)

  const traeCn = result.find((g) => g.path.length === 1 && g.path[0] === 'trae-cn')
  assert.ok(traeCn)
  assert.equal(traeCn.state, 'on')
  assert.equal(traeCn.count, 1)

  const other = result.find((g) => g.path.length === 1 && g.path[0] === 'other')
  assert.ok(other)
  assert.equal(other.state, 'off')
  assert.equal(other.count, 1)
})

/* ------------------------------------------------------------------ */
/* deriveGroupStates — sorting                                         */
/* ------------------------------------------------------------------ */

test('deriveGroupStates sorts by depth then alphabetically', async () => {
  await loadRoutes()
  const entries = [
    makeListedEntry('z.skills.alpha', ['z', 'skills', 'alpha'], true),
    makeListedEntry('a.skills.beta', ['a', 'skills', 'beta'], true),
  ]
  const result = routes.deriveGroupStates(entries)

  // L1 groups should come first, sorted alphabetically.
  const l1Groups = result.filter((g) => g.path.length === 1)
  assert.equal(l1Groups.length, 2)
  assert.equal(l1Groups[0]!.path[0], 'a')
  assert.equal(l1Groups[1]!.path[0], 'z')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAddArgs, positional } from '../src/cli/args.js'

/* ------------------------------------------------------------------ */
/* parseAddArgs — the tiny argv parser for `add`                       */
/* ------------------------------------------------------------------ */

test('spec is the first positional', () => {
  assert.deepEqual(parseAddArgs(['github:owner/repo']), {
    spec: 'github:owner/repo',
    name: undefined,
    ref: undefined,
    subdir: undefined,
    yes: false,
  })
})

test('--subdir sets the skill root inside the repo', () => {
  const opts = parseAddArgs(['github:owner/repo', '--subdir', 'skills/foo'])
  assert.equal(opts.subdir, 'skills/foo')
  assert.equal(opts.spec, 'github:owner/repo')
})

test('--subdir without a value throws', () => {
  assert.throws(() => parseAddArgs(['github:owner/repo', '--subdir']), /--subdir requires a path/)
})

test('--name sets the skill name', () => {
  const opts = parseAddArgs(['github:owner/repo', '--name', 'my-skill'])
  assert.equal(opts.spec, 'github:owner/repo')
  assert.equal(opts.name, 'my-skill')
})

test('--ref and --branch set the ref', () => {
  assert.equal(parseAddArgs(['owner/repo', '--ref', 'dev']).ref, 'dev')
  assert.equal(parseAddArgs(['owner/repo', '--branch', 'v2']).ref, 'v2')
})

test('--yes / -y / --force set yes', () => {
  assert.equal(parseAddArgs(['owner/repo', '--yes']).yes, true)
  assert.equal(parseAddArgs(['owner/repo', '-y']).yes, true)
  assert.equal(parseAddArgs(['owner/repo', '--force']).yes, true)
})

test('options can appear before the spec', () => {
  const opts = parseAddArgs(['--yes', '--name', 'x', 'owner/repo'])
  assert.equal(opts.spec, 'owner/repo')
  assert.equal(opts.name, 'x')
  assert.equal(opts.yes, true)
})

test('unknown flags are ignored', () => {
  const opts = parseAddArgs(['--verbose', 'owner/repo'])
  assert.equal(opts.spec, 'owner/repo')
})

test('missing spec throws', () => {
  assert.throws(() => parseAddArgs([]), /missing repo spec/)
  assert.throws(() => parseAddArgs(['--yes']), /missing repo spec/)
})

test('the last positional wins as spec', () => {
  // The parser is intentionally naive: each non-flag token overwrites spec.
  const opts = parseAddArgs(['owner/repo', 'other/repo'])
  assert.equal(opts.spec, 'other/repo')
})

/* ------------------------------------------------------------------ */
/* positional — first non-flag argument                                */
/* ------------------------------------------------------------------ */

test('positional returns the first non-flag argument', () => {
  // `value` is the first token that does not start with "-" — the parser is
  // deliberately ignorant of which flags consume values.
  assert.equal(positional(['--flag', 'value', 'target']), 'value')
  assert.equal(positional([]), undefined)
  assert.equal(positional(['-x']), undefined)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stderr } from 'node:process'
import { batchPrefix, clampToWidth, startSpinner, withSpinner } from '../src/cli/progress.js'

/* ------------------------------------------------------------------ */
/* batchPrefix — pure, context-independent                             */
/* ------------------------------------------------------------------ */

test('batchPrefix is empty for a single item', () => {
  assert.equal(batchPrefix(1, 1), '')
  assert.equal(batchPrefix(1, 0), '')
})

test('batchPrefix renders [i/N] only when there are multiple items', () => {
  assert.equal(batchPrefix(1, 3), '[1/3] ')
  assert.equal(batchPrefix(3, 3), '[3/3] ')
  assert.equal(batchPrefix(2, 10), '[2/10] ')
})

/* ------------------------------------------------------------------ */
/* Spinner — the test runner is a non-TTY, so everything is a no-op    */
/* ------------------------------------------------------------------ */

test('startSpinner is a silent no-op on a non-TTY', () => {
  // Guard the assumption the whole design rests on: tests run without a TTY.
  assert.ok(!stderr.isTTY, 'expected stderr to be a non-TTY under the test runner')

  const spinner = startSpinner('working')
  // update/stop must be safe to call and must not throw.
  spinner.update('still working')
  spinner.stop()
  // stop is idempotent.
  spinner.stop()
})

test('withSpinner resolves the wrapped value and stops the spinner', async () => {
  const value = await withSpinner('computing', async () => 42)
  assert.equal(value, 42)
})

test('withSpinner stops the spinner even when the wrapped fn rejects', async () => {
  await assert.rejects(
    withSpinner('failing', async () => {
      throw new Error('boom')
    }),
    /boom/,
  )
  // No stuck animation / leaked timer to assert directly on a no-op spinner;
  // reaching here without a hang is the guarantee (the finally block ran).
})

/* ------------------------------------------------------------------ */
/* clampToWidth — keeps the spinner line from wrapping (pure)          */
/* ------------------------------------------------------------------ */

test('clampToWidth leaves text within budget untouched', () => {
  assert.equal(clampToWidth('cloning (main)', 40), 'cloning (main)')
  assert.equal(clampToWidth('12345', 5), '12345') // exactly at budget
})

test('clampToWidth truncates over-budget text with a single-cell ellipsis', () => {
  const out = clampToWidth('resolving default branch for a/very/long/url', 20)
  assert.equal(out.length, 20) // never exceeds the width → never wraps
  assert.ok(out.endsWith('…'))
  assert.equal(out, 'resolving default b…')
})

test('clampToWidth handles degenerate budgets', () => {
  assert.equal(clampToWidth('abc', 1), '…') // budget 1 → just the ellipsis
  assert.equal(clampToWidth('abc', 0), '') // non-positive → empty
})

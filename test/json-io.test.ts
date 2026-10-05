import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsonIO, emitJson, fatalJsonError } from '../src/cli/json-io.js'
import { NeedsConfirm } from '../src/ops-io.js'
import type { OpsIO } from '../src/ops-io.js'
import type { ListJsonReport } from '../src/cli/json-types.js'

/**
 * Tests for the `--json` half of the OpsIO seam (`src/cli/json-io.ts`).
 *
 * The contract these pin is "stdout stays pure": a command running under
 * `--json` must write nothing to stdout except the one report the emitter
 * produces, because the whole point of the machine interface is that a caller
 * can `JSON.parse` stdout without filtering. Diagnostics are explicitly *not*
 * part of that contract (P0 §2.2), so they keep going to stderr — losing them
 * would be worse than a mixed stream.
 *
 * No filesystem, no git, no manifest: these are the seam's own behaviours.
 */

/** Collect everything an io writes, per channel. */
function recordingIO(): { io: OpsIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  const io: OpsIO = {
    interactive: false,
    confirm: () => Promise.resolve(false),
    progress: () => {},
    emit: (line: string) => {
      out.push(line)
    },
    error: (line: string) => {
      err.push(line)
    },
  }
  return { io, out, err }
}

/* ------------------------------------------------------------------ */
/* jsonIO — silent on human channels, honest about diagnostics         */
/* ------------------------------------------------------------------ */

test('jsonIO swallows emit and progress so stdout stays parseable', () => {
  const { io, out, err } = recordingIO()
  const silent = jsonIO(io)
  silent.emit('Added skill "x" from github:o/r\n')
  silent.progress('cloning', 'main')
  assert.deepEqual(out, [], 'no human batch line may reach the report stream')
  assert.deepEqual(err, [], 'progress is not a diagnostic')
})

test('jsonIO forwards diagnostics to the caller’s error channel', () => {
  const { io, err } = recordingIO()
  const silent = jsonIO(io)
  silent.error('No skill named "ghost".')
  assert.deepEqual(err, ['No skill named "ghost".'])
})

test('jsonIO without a fallback drops diagnostics instead of throwing', () => {
  // Some call sites have no outer io to delegate to; the contract is "best
  // effort", not "always present".
  const silent = jsonIO()
  assert.doesNotThrow(() => {
    silent.error('gone')
  })
})

test('jsonIO is never interactive', () => {
  assert.equal(jsonIO().interactive, false)
})

/* ------------------------------------------------------------------ */
/* confirm — answers the default, never raises NeedsConfirm            */
/* ------------------------------------------------------------------ */

test('jsonIO.confirm resolves the default value without blocking', async () => {
  const silent = jsonIO()
  assert.equal(await silent.confirm('Remove 3 skills?', false), false)
  assert.equal(await silent.confirm('Proceed?', true), true)
})

test('jsonIO.confirm does not raise NeedsConfirm the way the HTTP half does', async () => {
  // The distinction that matters: a machine caller is not a missing
  // confirmation *channel*. `--json` runs are non-interactive, so the guards
  // that key off `interactive` keep refusing — but `confirm` itself answers,
  // which is what lets the install cores finish their cleanup paths.
  const silent = jsonIO()
  await assert.doesNotReject(() => silent.confirm('Discard local changes?', false))
  const httpLike: OpsIO = {
    interactive: false,
    confirm: (q, d) => Promise.reject(new NeedsConfirm(q, d)),
    progress: () => {},
    emit: () => {},
    error: () => {},
  }
  await assert.rejects(() => httpLike.confirm('Discard local changes?', false), NeedsConfirm)
})

/* ------------------------------------------------------------------ */
/* spin — runs the step inline (no terminal to animate)                */
/* ------------------------------------------------------------------ */

test('jsonIO.spin runs the step inline and resolves its value', async () => {
  const silent = jsonIO()
  assert.ok(silent.spin, 'jsonIO provides spin, so cores never fall back to a no-op')
  const order: string[] = []
  const value = await silent.spin('cloning (main)', async () => {
    order.push('inside')
    return 42
  })
  assert.equal(value, 42)
  assert.deepEqual(order, ['inside'])
})

test('jsonIO.spin propagates a rejection untouched', async () => {
  const silent = jsonIO()
  await assert.rejects(
    () => silent.spin!('cloning', () => Promise.reject(new Error('network down'))),
    /network down/,
  )
})

/* ------------------------------------------------------------------ */
/* emitJson — the framing promise (P0 §2.1)                            */
/* ------------------------------------------------------------------ */

test('emitJson writes 2-space JSON with exactly one trailing newline', () => {
  const { io, out } = recordingIO()
  const report: ListJsonReport = { version: 1, entries: [] }
  emitJson(io, report)
  assert.equal(out.length, 1, 'the report is one emit call')
  const text = out[0]!
  assert.equal(text, `${JSON.stringify(report, null, 2)}\n`)
  assert.ok(text.endsWith('}\n'))
  assert.ok(text.includes('\n  "version": 1'))
})

test('emitJson round-trips through JSON.parse', () => {
  const { io, out } = recordingIO()
  const report: ListJsonReport = {
    version: 1,
    entries: [
      {
        name: 'r',
        url: 'github:o/r',
        ref: 'main',
        subdir: null,
        commit: null,
        hasGitSource: true,
        ownership: 'managed',
        enabled: false,
        links: [],
        update: null,
      },
    ],
  }
  emitJson(io, report)
  assert.deepEqual(JSON.parse(out.join('')), report)
})

/* ------------------------------------------------------------------ */
/* fatalJsonError — the machine shape of a usage / fatal error         */
/* ------------------------------------------------------------------ */

test('fatalJsonError writes { version, error.message } to the error channel', () => {
  const { io, out, err } = recordingIO()
  fatalJsonError(io, 'unknown argument "--nope"')
  assert.deepEqual(out, [], 'an error never lands on the report stream')
  assert.equal(err.length, 1)
  assert.equal(err[0], `${JSON.stringify({ version: 1, error: { message: 'unknown argument "--nope"' } }, null, 2)}`)
})

test('a consumer that captured only stdout sees an empty stream on a fatal', () => {
  // The reason the fatal goes to stderr: half a report on stdout would parse
  // as a truncated document, which is worse than an empty one.
  const { io, out } = recordingIO()
  fatalJsonError(io, 'boom')
  assert.equal(out.join(''), '')
})

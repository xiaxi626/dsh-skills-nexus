import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NeedsConfirm, cliIO } from '../src/ops-io.js'

/**
 * Tests for the OpsIO seam (`src/ops-io.ts`).
 *
 * `cliIO` is the CLI half of the seam (§4.2). Its contract is byte-level —
 * the ported call sites (`process.stdout.write` → `io.emit`) must keep
 * producing identical output — so these tests capture the real process
 * streams rather than mocking the interface.
 *
 * TTY state is forced explicitly in both directions (`withTTY`) instead of
 * relying on the runner's environment: `node --test` is normally a non-TTY,
 * but a developer running the suite attached to a terminal must not change
 * what these tests exercise.
 */

/* ------------------------------------------------------------------ */
/* Helpers (stream capture as in test/completions.test.ts)             */
/* ------------------------------------------------------------------ */

/** Run `fn` with stdout/stderr writes captured verbatim. */
async function captureStreams(
  fn: () => void | Promise<void>,
): Promise<{ out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: any) => {
    out.push(String(chunk))
    return true
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (chunk: any) => {
    err.push(String(chunk))
    return true
  }
  try {
    await fn()
    return { out: out.join(''), err: err.join('') }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

/** A stream whose `isTTY` the test controls. */
type TtyStream = { isTTY?: boolean }

/** Run `fn` with `stream.isTTY` forced to `tty`, restoring it afterwards. */
async function withTTY<T>(
  stream: TtyStream,
  tty: boolean,
  fn: () => T | Promise<T>,
): Promise<T> {
  const desc = Object.getOwnPropertyDescriptor(stream, 'isTTY')
  Object.defineProperty(stream, 'isTTY', { value: tty, configurable: true })
  try {
    return await fn()
  } finally {
    if (desc) Object.defineProperty(stream, 'isTTY', desc)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else delete (stream as any).isTTY
  }
}

/* ------------------------------------------------------------------ */
/* emit — stdout summary, byte-for-byte                                */
/* ------------------------------------------------------------------ */

test('emit passes a newline-terminated string through byte for byte', async () => {
  const { out, err } = await captureStreams(() => cliIO.emit('  ✓ up to date (abc1234)\n'))
  assert.equal(out, '  ✓ up to date (abc1234)\n')
  assert.equal(err, '')
})

test('emit appends the missing trailing newline', async () => {
  const { out } = await captureStreams(() => cliIO.emit('no newline'))
  assert.equal(out, 'no newline\n')
})

test('emit never doubles an existing newline', async () => {
  const { out } = await captureStreams(() => {
    cliIO.emit('a\n')
    cliIO.emit('b')
  })
  assert.equal(out, 'a\nb\n')
})

/* ------------------------------------------------------------------ */
/* progress — stderr line, TTY-gated                                   */
/* ------------------------------------------------------------------ */

test('progress is a silent no-op when stderr is not a TTY', async () => {
  const { out, err } = await captureStreams(() =>
    withTTY(process.stderr, false, () => cliIO.progress('fetching', 'main')),
  )
  assert.equal(out, '')
  assert.equal(err, '')
})

test('progress writes one stderr line when stderr is a TTY', async () => {
  const { out, err } = await captureStreams(() =>
    withTTY(process.stderr, true, () => {
      cliIO.progress('fetching', 'main')
      cliIO.progress('done')
    }),
  )
  assert.equal(out, '')
  assert.equal(err, 'fetching: main\ndone\n')
})

/* ------------------------------------------------------------------ */
/* interactive — reflects stdin.isTTY live                             */
/* ------------------------------------------------------------------ */

test('interactive reflects stdin.isTTY at read time', async () => {
  await withTTY(process.stdin, false, () => {
    assert.equal(cliIO.interactive, false)
  })
  await withTTY(process.stdin, true, () => {
    assert.equal(cliIO.interactive, true)
  })
  await withTTY(process.stdin, false, () => {
    assert.equal(cliIO.interactive, false)
  })
})

/* ------------------------------------------------------------------ */
/* confirm — delegates to prompt.confirm                               */
/* ------------------------------------------------------------------ */

test('confirm resolves to the default value when stdin is not a TTY', async () => {
  await withTTY(process.stdin, false, async () => {
    assert.equal(await cliIO.confirm('Proceed?', true), true)
    assert.equal(await cliIO.confirm('Proceed?', false), false)
  })
})

/* ------------------------------------------------------------------ */
/* NeedsConfirm — the HTTP-side escape hatch                           */
/* ------------------------------------------------------------------ */

test('NeedsConfirm carries the question and its default', () => {
  const err = new NeedsConfirm('Discard local changes and switch?', false)
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'NeedsConfirm')
  assert.equal(err.message, 'Discard local changes and switch?')
  assert.equal(err.question, 'Discard local changes and switch?')
  assert.equal(err.defaultValue, false)
})

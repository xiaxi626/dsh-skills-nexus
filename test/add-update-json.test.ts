import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Tests for `add --json` (P0 §4.2) and `update --json` (P0 §4.3).
 *
 * Both commands are git-bound — `add` clones, `update` pulls — so the fixtures
 * are real `file://` repositories, the same pattern as `test/add.test.ts` and
 * `test/update.test.ts`. One file covers both because they share the fixture
 * and the per-item aggregation model: each spec/entry is attempted
 * independently, a failure on one does not abort the rest, and the exit code is
 * non-zero if any item failed.
 *
 * What these pin, beyond the shape of the report:
 *   - stdout carries the JSON document and nothing else, so `--json` never
 *     needs a human-text filter in front of `JSON.parse`;
 *   - diagnostics (`error`) still reach stderr;
 *   - a per-item failure lands in `results[].error`/`code`, not in a thrown
 *     exception that would abort the batch;
 *   - `--json` never prompts: a step that would have asked is answered with the
 *     default, so the JSON path must be given `--yes` for those.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the manifest→paths chain.
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

let home: string
let addMod: typeof import('../src/cli/commands/add.js')
let updateMod: typeof import('../src/cli/commands/update.js')
let manifest: typeof import('../src/manifest.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-json-write-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  addMod = await import('../src/cli/commands/add.js')
  updateMod = await import('../src/cli/commands/update.js')
  manifest = await import('../src/manifest.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

interface Capture {
  code: number
  out: string
  err: string
  report: Record<string, unknown>
}

/**
 * Run a command with both channels captured. `report` is lazy so a test may
 * assert an empty stdout (a usage error) without tripping over `JSON.parse`.
 */
async function run(
  fn: (io: OpsIO) => Promise<number>,
): Promise<Capture> {
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
  const code = await fn(io)
  const text = out.join('')
  return {
    code,
    out: text,
    err: err.join(''),
    get report(): Record<string, unknown> {
      assert.notEqual(text, '', 'expected a JSON report on stdout')
      assert.ok(text.endsWith('\n'), 'the report ends with a newline')
      assert.ok(text.startsWith('{\n  "version": 1'), 'the report is 2-space indented JSON')
      return JSON.parse(text) as Record<string, unknown>
    },
  }
}

/** Create a one-skill git repo under `home` and return its `file://` URL. */
async function makeRepo(name: string, skillName = name): Promise<string> {
  const src = join(home, name)
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'SKILL.md'), `---\nname: ${skillName}\n---\nbody\n`, 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'initial'])
  return `${fileUrl(src)}#main`
}

/** Wipe every registered entry so each test starts from an empty manifest. */
async function reset(): Promise<void> {
  for (const s of (await manifest.readManifest()).skills) await manifest.removeEntry(s.name)
}

interface AddResult {
  spec: string
  status: string
  name?: string
  commit?: string
  ref?: string
  links?: string[]
  code?: string
  error?: string
}

interface AddReport {
  version: number
  results: AddResult[]
  summary: { added: number; skipped: number; failed: number }
}

/* ------------------------------------------------------------------ */
/* add --json                                                          */
/* ------------------------------------------------------------------ */

test('add --json reports one added spec with its commit and links', async () => {
  await reset()
  const url = await makeRepo('json-source')
  const cap = await run((io) => addMod.add([url, '--json'], io))

  assert.equal(cap.code, 0)
  const report = cap.report as unknown as AddReport
  assert.equal(report.results.length, 1)
  const first = report.results[0]!
  assert.equal(first.spec, url)
  assert.equal(first.status, 'added')
  assert.equal(first.name, 'json-source')
  assert.match(first.commit!, /^[0-9a-f]{40}$/)
  assert.equal(first.ref, 'main')
  assert.deepEqual(first.links, ['json-source'])
  // No --subdir was given, so the field is absent rather than null.
  assert.equal('subdir' in first, false)
  assert.deepEqual(report.summary, { added: 1, skipped: 0, failed: 0 })
})

test('add --json keeps stdout pure: the clone banner goes nowhere', async () => {
  await reset()
  const url = await makeRepo('json-pure')
  const cap = await run((io) => addMod.add([url, '--json'], io))
  // The human run prints "Cloning …", "Added skill …" and friends through
  // `emit`; none of that may reach the report stream.
  assert.doesNotMatch(cap.out, /Cloning/)
  assert.doesNotMatch(cap.out, /Added skill/)
  assert.doesNotMatch(cap.out, /symlinks:/)
})

test('add --json isolates a per-item failure and still installs the rest', async () => {
  await reset()
  const good = await makeRepo('json-good')
  const bad = `${fileUrl(join(home, 'does-not-exist'))}#main`
  const cap = await run((io) => addMod.add([bad, good, '--json'], io))

  assert.equal(cap.code, 1, 'a failed item makes the run non-zero')
  const report = cap.report as unknown as AddReport
  assert.deepEqual(
    report.results.map((r) => [r.spec, r.status]),
    [
      [bad, 'failed'],
      [good, 'added'],
    ],
  )
  // The failure carries a reason rather than aborting the batch.
  assert.ok(report.results[0]!.error, 'the failed item explains itself')
  assert.deepEqual(report.summary, { added: 1, skipped: 0, failed: 1 })
  // The diagnostic went to stderr, not into the document.
  assert.match(cap.err, /✗/)
})

test('add --json reports a re-registration as failed with the refusal text', async () => {
  await reset()
  const url = await makeRepo('json-dupe')
  assert.equal(await addMod.add([url, '--json'], noopIO()), 0)
  const cap = await run((io) => addMod.add([url, '--json'], io))
  assert.equal(cap.code, 1)
  const report = cap.report as unknown as AddReport
  assert.equal(report.results[0]!.status, 'failed')
  assert.match(report.results[0]!.error!, /already registered/)
})

test('add --json with several specs plus --name is a usage error (exit 2)', async () => {
  await reset()
  const cap = await run((io) => addMod.add(['a', 'b', '--name', 'x', '--json'], io))
  assert.equal(cap.code, 2)
  assert.equal(cap.out, '')
  // P0 §4.6: the machine dialect, on stderr.
  const payload = JSON.parse(cap.err) as { version: number; error: { message: string } }
  assert.equal(payload.version, 1)
  assert.match(payload.error.message, /--name applies to a single repo/)
})

test('add --json=false is a usage error reported in the machine dialect', async () => {
  await reset()
  const cap = await run((io) => addMod.add(['github:o/r', '--json=false'], io))
  assert.equal(cap.code, 2)
  assert.equal(cap.out, '')
  const payload = JSON.parse(cap.err) as { version: number; error: { message: string } }
  assert.equal(payload.version, 1)
  assert.match(payload.error.message, /takes no value/)
})

/* ------------------------------------------------------------------ */
/* getHeadCommit — update's before/after source                        */
/* ------------------------------------------------------------------ */

interface UpdateResult {
  name: string
  status: string
  ref: string
  fromCommit: string | null
  toCommit: string | null
  error?: string
}

interface UpdateReport {
  version: number
  results: UpdateResult[]
  summary: { updated: number; failed: number }
}

/** Commit one more change in a fixture repo so `update` has something to pull. */
async function advance(dir: string, file: string, body: string): Promise<string> {
  await writeFile(join(dir, file), body, 'utf8')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', `add ${file}`])
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })
  return stdout.trim()
}

/** An io that swallows everything — for setup calls whose report is unused. */
function noopIO(): OpsIO {
  return {
    interactive: false,
    confirm: () => Promise.resolve(false),
    progress: () => {},
    emit: () => {},
    error: () => {},
  }
}

/* ------------------------------------------------------------------ */
/* update --json                                                       */
/* ------------------------------------------------------------------ */

test('update --json reports up-to-date with identical from/to commits', async () => {
  await reset()
  const url = await makeRepo('json-update')
  assert.equal(await addMod.add([url, '--json'], noopIO()), 0)

  const cap = await run((io) => updateMod.update(['json-update', '--json'], io))
  assert.equal(cap.code, 0)
  const report = cap.report as unknown as UpdateReport
  assert.equal(report.results.length, 1)
  const r = report.results[0]!
  assert.equal(r.name, 'json-update')
  assert.equal(r.status, 'up-to-date')
  assert.equal(r.ref, 'main')
  assert.match(r.fromCommit!, /^[0-9a-f]{40}$/)
  assert.equal(r.toCommit, r.fromCommit, 'nothing upstream — the commits match')
  assert.deepEqual(report.summary, { updated: 0, failed: 0 })
})

test('update --json reports the before→after pair when upstream moved', async () => {
  await reset()
  const src = join(home, 'json-moved')
  const url = await makeRepo('json-moved')
  assert.equal(await addMod.add([url, '--json'], noopIO()), 0)
  const beforeCommit = (await manifest.readManifest()).skills.find((s) => s.name === 'json-moved')!.commit
  assert.match(beforeCommit!, /^[0-9a-f]{40}$/)
  const afterCommit = await advance(src, 'EXTRA.md', 'more\n')
  assert.notEqual(afterCommit, beforeCommit)

  const cap = await run((io) => updateMod.update(['json-moved', '--json'], io))
  assert.equal(cap.code, 0)
  const report = cap.report as unknown as UpdateReport
  const r = report.results[0]!
  // The clone was installed at the old commit and the pull moved it: the pair
  // is the whole point of the field, so both halves are asserted.
  assert.equal(r.status, 'updated')
  assert.equal(r.fromCommit, beforeCommit)
  assert.equal(r.toCommit, afterCommit)
  assert.deepEqual(report.summary, { updated: 1, failed: 0 })
})

test('update --json refuses an unknown target in the machine dialect, exit 1', async () => {
  await reset()
  const cap = await run((io) => updateMod.update(['ghost', '--json'], io))
  assert.equal(cap.code, 1)
  assert.equal(cap.out, '', 'no report is emitted for an unknown target')
  const payload = JSON.parse(cap.err) as { version: number; error: { message: string } }
  assert.equal(payload.version, 1)
  assert.match(payload.error.message, /No skill named "ghost"/)
})

test('update --json on an empty manifest is an empty report', async () => {
  await reset()
  const cap = await run((io) => updateMod.update(['--json'], io))
  assert.equal(cap.code, 0)
  const report = cap.report as unknown as UpdateReport
  assert.deepEqual(report.results, [])
  assert.deepEqual(report.summary, { updated: 0, failed: 0 })
  assert.doesNotMatch(cap.out, /Nothing to update/)
})

test('update --json=false is a usage error reported in the machine dialect', async () => {
  await reset()
  const cap = await run((io) => updateMod.update(['--json=1'], io))
  assert.equal(cap.code, 2)
  assert.equal(cap.out, '')
  const payload = JSON.parse(cap.err) as { version: number; error: { message: string } }
  assert.equal(payload.version, 1)
  assert.match(payload.error.message, /takes no value/)
})

test('update --json rejects a second positional rather than updating one of them', async () => {
  await reset()
  const cap = await run((io) => updateMod.update(['a', 'b', '--json'], io))
  assert.equal(cap.code, 2)
  assert.equal(cap.out, '')
  const payload = JSON.parse(cap.err) as { version: number; error: { message: string } }
  assert.match(payload.error.message, /one entry name at a time/)
})

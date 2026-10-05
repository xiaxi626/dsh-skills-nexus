import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Tests for `enable` / `disable --json` (P0 §4.5) and the batch form of the
 * same commands (gap-closure A3).
 *
 * Deliberately **git-free**: `toggle` never shells out to git — it reads the
 * manifest, scans the official skills root for symlinks pointing into the
 * entry's clone, and (for `enable`) re-discovers the skills the clone yields.
 * So the fixtures here write the manifest and the `repos/<path>/` tree by hand
 * instead of cloning, which keeps this file fast and independent of a git
 * binary — the same reason `test/list.test.ts` seeds its manifest directly.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the manifest→paths chain (same pattern as
 * test/toggle.test.ts).
 */

let home: string
let toggleMod: typeof import('../src/cli/commands/toggle.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-toggle-json-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  toggleMod = await import('../src/cli/commands/toggle.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * Capture both channels of one `toggle` call.
 *
 * `report` is a lazy getter: the usage-error tests assert an *empty* stdout, so
 * parsing eagerly would turn "the command correctly wrote nothing" into a
 * SyntaxError before the assertion could say so.
 */
async function runJson(
  argv: string[],
  enabled: boolean,
): Promise<{ code: number; out: string; err: string; report: ToggleReport }> {
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
  const code = await toggleMod.toggle(argv, enabled, io)
  const text = out.join('')
  return {
    code,
    out: text,
    err: err.join(''),
    get report(): ToggleReport {
      assert.notEqual(text, '', 'expected a JSON report on stdout')
      return JSON.parse(text) as ToggleReport
    },
  }
}

interface ToggleReport {
  version: number
  results: Array<{
    name: string
    action: string
    status: string
    enabled: boolean
    linksChanged: number
    already: boolean
    error?: string
  }>
  summary: { toggled: number; already: number; failed: number }
}

/** Seed the manifest with one entry and an optional on-disk clone. */
async function seed(
  name: string,
  opts: { skills?: string[]; linkNames?: string[] } = {},
): Promise<void> {
  for (const s of (await manifest.readManifest()).skills) await manifest.removeEntry(s.name)
  // Clear the skills root too: stale links from a previous test would be
  // attributed to this entry the moment its clone exists.
  for (const existing of await readdir(paths.OFFICIAL_SKILLS_DIR).catch(() => [])) {
    await link.unlinkSkill(existing)
  }
  await manifest.addEntry({
    name,
    url: `github:owner/${name}`,
    gitUrl: `https://github.com/owner/${name}.git`,
    ref: 'main',
    path: name,
    addedAt: new Date().toISOString(),
  })
  const dir = paths.repoDir(name)
  await mkdir(dir, { recursive: true })
  for (const skill of opts.skills ?? []) {
    await writeFile(join(dir, `skill-${skill}.md`), `---\nname: skill-${skill}\n---\nS`, 'utf8')
  }
  for (const linkName of opts.linkNames ?? []) {
    await link.linkSkill(linkName, dir)
  }
}

/* ------------------------------------------------------------------ */
/* Report shape                                                        */
/* ------------------------------------------------------------------ */

test('disable --json emits one version-1 report and nothing else on stdout', async () => {
  await seed('solo', { skills: ['solo'], linkNames: ['solo'] })
  const { code, out, report } = await runJson(['solo', '--json'], false)
  assert.equal(code, 0)
  assert.ok(out.endsWith('\n'), 'the report ends in a newline')
  assert.ok(out.startsWith('{\n  "version": 1'), 'the report is 2-space indented JSON')
  assert.deepEqual(report.results, [
    {
      name: 'solo',
      action: 'disable',
      status: 'toggled',
      enabled: false,
      linksChanged: 1,
      already: false,
    },
  ])
  assert.deepEqual(report.summary, { toggled: 1, already: 0, failed: 0 })
})

test('enable --json reports the action and counts the links it created', async () => {
  // Two flat skills in one clone: enable must create both links, so
  // `linksChanged` is 2 and the per-skill names are not the entry's.
  await seed('multi', { skills: ['one', 'two'] })
  const { code, report } = await runJson(['multi', '--json'], true)
  assert.equal(code, 0)
  assert.equal(report.results[0]!.action, 'enable')
  assert.equal(report.results[0]!.status, 'toggled')
  assert.equal(report.results[0]!.enabled, true)
  assert.equal(report.results[0]!.linksChanged, 2)
})

test('a no-op toggle reports already:true and changes no link', async () => {
  await seed('idle', { skills: ['idle'], linkNames: ['idle'] })
  const { code, report } = await runJson(['idle', '--json'], true)
  assert.equal(code, 0)
  assert.equal(report.results[0]!.status, 'already')
  assert.equal(report.results[0]!.already, true)
  assert.equal(report.results[0]!.linksChanged, 0)
  assert.equal(report.results[0]!.enabled, true, 'the resulting state, not the requested one')
  assert.deepEqual(report.summary, { toggled: 0, already: 1, failed: 0 })
})

test('an unknown name is a per-item not-found and exits 1', async () => {
  await seed('real', { skills: ['real'], linkNames: ['real'] })
  const { code, report } = await runJson(['ghost', '--json'], false)
  assert.equal(code, 1)
  assert.equal(report.results[0]!.status, 'not-found')
  // `enabled` is what the entry has now — there is no entry, so it keeps the
  // state it was asked to leave: still enabled.
  assert.equal(report.results[0]!.enabled, true)
  assert.deepEqual(report.summary, { toggled: 0, already: 0, failed: 1 })
})

/* ------------------------------------------------------------------ */
/* Batch (A3) — several names in one run                               */
/* ------------------------------------------------------------------ */

test('--json handles several names independently, in argument order', async () => {
  await seed('alpha', { skills: ['alpha'], linkNames: ['alpha'] })
  // Second entry seeded by hand: `seed` resets the manifest, so adding one on
  // top is the only way to get a two-entry fixture.
  await manifest.addEntry({
    name: 'beta',
    url: 'github:owner/beta',
    gitUrl: 'https://github.com/owner/beta.git',
    ref: 'main',
    path: 'beta',
    addedAt: new Date().toISOString(),
  })
  await mkdir(paths.repoDir('beta'), { recursive: true })
  await link.linkSkill('beta', paths.repoDir('beta'))

  const { code, report } = await runJson(['alpha', 'ghost', 'beta', '--json'], false)
  assert.equal(code, 1, 'one not-found makes the whole run non-zero')
  assert.deepEqual(
    report.results.map((r) => [r.name, r.status]),
    [
      ['alpha', 'toggled'],
      ['ghost', 'not-found'],
      ['beta', 'toggled'],
    ],
  )
  assert.deepEqual(report.summary, { toggled: 2, already: 0, failed: 1 })
  // The failure did not stop the names after it: both real entries are disabled.
  assert.equal(await link.isLinked('alpha'), false)
  assert.equal(await link.isLinked('beta'), false)
})

test('one name failing still leaves the others toggled (batch is not all-or-nothing)', async () => {
  await seed('kept', { skills: ['kept'], linkNames: ['kept'] })
  const { code, report } = await runJson(['kept', 'missing', '--json'], false)
  assert.equal(code, 1)
  assert.equal(report.results[0]!.status, 'toggled')
  assert.equal(report.results[1]!.status, 'not-found')
  assert.equal(await link.isLinked('kept'), false, 'the link of the successful name is gone')
})

/* ------------------------------------------------------------------ */
/* Usage errors — machine dialect on stderr, exit 2                    */
/* ------------------------------------------------------------------ */

test('a usage error under --json answers in JSON on stderr, exit 2', async () => {
  const { code, out, err } = await runJson(['--json=1', 'x'], false)
  assert.equal(code, 2)
  assert.equal(out, '', 'a usage error writes nothing to the report stream')
  const payload = JSON.parse(err) as { version: number; error: { message: string } }
  assert.equal(payload.version, 1)
  assert.match(payload.error.message, /takes no value/)
})

test('a usage error without --json stays a plain stderr sentence, exit 2', async () => {
  const { code, out, err } = await runJson(['--nope'], false)
  assert.equal(code, 2)
  assert.equal(out, '')
  assert.match(err, /unknown argument/)
  assert.throws(() => JSON.parse(err), 'a human run must not get a JSON document')
})

test('a missing name is a usage error naming the command that was run', async () => {
  const enable = await runJson([], true)
  assert.equal(enable.code, 2)
  assert.match(enable.err, /enable <name>/)
  const disable = await runJson([], false)
  assert.equal(disable.code, 2)
  assert.match(disable.err, /disable <name>/)
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for the `list` SOURCE column, the `--names` machine path and the pure
 * `sourceLabel` derivation.
 *
 * `sourceLabel` is pure (no FS / no I/O), so the canonical `owner/repo`
 * derivation is unit-tested directly across the git URL forms `parseGitSpec`
 * can produce. The `list` rendering is integration-tested by seeding the
 * manifest (no real clone needed — `list` reads only manifest.json) and
 * capturing stdout (same pattern as the list test in test/toggle.test.ts).
 *
 * `--names` is the stream shell completions shell out to, so its tests pin the
 * machine contract: names only, one per line, manifest order — and nothing at
 * all on stdout when the call is a usage error.
 *
 * paths.ts reads DSH_HOME at import time, so the env var must be set before the
 * first import of the manifest→paths chain (same pattern as test/remove.test.ts).
 */

let home: string
let listMod: typeof import('../src/cli/commands/list.js')
let manifest: typeof import('../src/manifest.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-list-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  listMod = await import('../src/cli/commands/list.js')
  manifest = await import('../src/manifest.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* sourceLabel — pure derivation to a canonical owner/repo             */
/* ------------------------------------------------------------------ */

test('sourceLabel reduces an https GitHub URL to owner/repo', () => {
  assert.equal(listMod.sourceLabel('https://github.com/owner/repo.git'), 'owner/repo')
})

test('sourceLabel strips a trailing .git and trailing slash', () => {
  assert.equal(listMod.sourceLabel('https://github.com/owner/repo/'), 'owner/repo')
})

test('sourceLabel handles the scp-like git@host:owner/repo form', () => {
  assert.equal(listMod.sourceLabel('git@github.com:owner/repo.git'), 'owner/repo')
})

test('sourceLabel handles ssh:// URLs', () => {
  assert.equal(listMod.sourceLabel('ssh://git@github.com/owner/repo.git'), 'owner/repo')
})

test('sourceLabel maps different spec forms of one repo to the same label', () => {
  const https = listMod.sourceLabel('https://github.com/owner/repo.git')
  const scp = listMod.sourceLabel('git@github.com:owner/repo.git')
  assert.equal(https, scp)
  assert.equal(https, 'owner/repo')
})

test('sourceLabel falls back to the lone segment for a bare path', () => {
  assert.equal(listMod.sourceLabel('repo'), 'repo')
})

test('sourceLabel returns an empty string unchanged', () => {
  assert.equal(listMod.sourceLabel(''), '')
})

/* ------------------------------------------------------------------ */
/* list rendering — SOURCE column surfaces and groups the origin repo  */
/* ------------------------------------------------------------------ */

/**
 * Capture everything `list` writes to stdout (mirrors test/toggle.test.ts) plus
 * stderr, so the `--names` machine path can be asserted to keep stdout pure.
 */
async function captureList(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const writes: string[] = []
  const errWrites: string[] = []
  const orig = process.stdout.write
  const origErr = process.stderr.write
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: any) => {
    writes.push(String(chunk))
    return true
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (chunk: any) => {
    errWrites.push(String(chunk))
    return true
  }
  try {
    const code = await listMod.list(argv)
    return { code, out: writes.join(''), err: errWrites.join('') }
  } finally {
    process.stdout.write = orig
    process.stderr.write = origErr
  }
}

/** Reset the manifest to exactly the given entries (seeded, no clone needed). */
async function reset(
  ...entries: Array<{ name: string; gitUrl: string; subdir?: string }>
): Promise<void> {
  for (const s of (await manifest.readManifest()).skills) await manifest.removeEntry(s.name)
  for (const e of entries) {
    await manifest.addEntry({
      name: e.name,
      url: e.gitUrl,
      gitUrl: e.gitUrl,
      ref: 'main',
      subdir: e.subdir,
      path: e.name,
      addedAt: new Date().toISOString(),
    })
  }
}

test('list prints a SOURCE header and the derived owner/repo for each row', async () => {
  await reset({ name: 'foo', gitUrl: 'https://github.com/owner/repo.git', subdir: 'skills/foo' })
  const { code, out } = await captureList([])
  assert.equal(code, 0)
  assert.match(out, /SOURCE/)
  assert.match(out, /owner\/repo/)
})

test('two subdir entries from one repo show the same SOURCE (origin is groupable)', async () => {
  await reset(
    { name: 'foo', gitUrl: 'https://github.com/trae-community/trae-skills.git', subdir: 'skills/foo' },
    { name: 'bar', gitUrl: 'https://github.com/trae-community/trae-skills.git', subdir: 'skills/bar' },
  )
  const { out } = await captureList([])
  const hits = out.split('trae-community/trae-skills').length - 1
  assert.equal(hits, 2)
})

test('an empty manifest short-circuits before the header (no SOURCE column)', async () => {
  await reset()
  const { code, out } = await captureList([])
  assert.equal(code, 0)
  assert.match(out, /No skills registered/)
  assert.doesNotMatch(out, /SOURCE/)
})

/* ------------------------------------------------------------------ */
/* list --names — the machine path (shell completion data source)      */
/* ------------------------------------------------------------------ */

test('--names prints only the skill names, one per line, in manifest order', async () => {
  await reset(
    { name: 'alpha', gitUrl: 'https://github.com/owner/a.git' },
    { name: 'beta', gitUrl: 'https://github.com/owner/b.git' },
  )
  const { code, out } = await captureList(['--names'])
  assert.equal(code, 0)
  // A consumer splits this on newlines — no header, padding or footer may leak in.
  assert.equal(out, 'alpha\nbeta\n')
})

test('--names on an empty manifest prints nothing, not the human hint', async () => {
  await reset()
  const { code, out } = await captureList(['--names'])
  assert.equal(code, 0)
  assert.equal(out, '')
})

test('--names=false is a usage error: exit 2 and stdout stays empty', async () => {
  await reset({ name: 'foo', gitUrl: 'https://github.com/owner/repo.git' })
  const { code, out, err } = await captureList(['--names=false'])
  assert.equal(code, 2)
  assert.equal(out, '')
  assert.match(err, /takes no value/)
})

test('an unknown argument is a usage error: exit 2 and stdout stays empty', async () => {
  await reset({ name: 'foo', gitUrl: 'https://github.com/owner/repo.git' })
  const { code, out } = await captureList(['--json'])
  assert.equal(code, 2)
  assert.equal(out, '')
})

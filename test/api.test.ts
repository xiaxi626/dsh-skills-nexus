import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RouteRequest, RouteResponse, RouteSpec } from '../src/http/types.js'
import type { Job } from '../src/http/jobs.js'
import type { SkillEntry } from '../src/types.js'

/**
 * Route-level tests for the §7.1 HTTP table (src/http/routes.ts).
 *
 * The specs are plain objects over a minimal req/res surface, so the suite
 * drives handlers directly — no server, no sockets. `call()` invokes the
 * handler and flushes the body afterwards: the handler's synchronous segment
 * always reaches `readBody` (its executor attaches the listeners), so a
 * synchronous flush is deterministic.
 *
 * paths.ts reads DSH_HOME at import time → env before dynamic import
 * (test/remove.test.ts pattern).
 *
 * No remote may be contacted: the network cores (add / update / import's git
 * channel / adopt's clone / check-updates) are exercised only through branches
 * that decide before any git call — pre-flight rejections, the synchronous
 * dry-run of §10.2 (a bare package has no label to probe), and snapshots. The
 * jobs that do run here are local filesystem work (add against a `file://`
 * fixture, import of a bare package, remove / toggle / cancel).
 */

/** The plan shape `POST /import?dryRun=true` answers with (§10.2). */
interface ImportPlanView {
  source: string
  labelled: boolean
  entries: Array<{
    name: string
    decision: { kind: string; reason?: string }
    conflict: boolean
  }>
  skipped: unknown[]
}

let home: string
let table: RouteSpec[]
let routes: typeof import('../src/http/routes.js')
let manifest: typeof import('../src/manifest.js')
let link: typeof import('../src/link.js')
let jobs: typeof import('../src/http/jobs.js')
let locks: typeof import('../src/locks.js')
let paths: typeof import('../src/paths.js')
let codec: typeof import('../src/zip.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-api-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  routes = await import('../src/http/routes.js')
  manifest = await import('../src/manifest.js')
  link = await import('../src/link.js')
  jobs = await import('../src/http/jobs.js')
  locks = await import('../src/locks.js')
  paths = await import('../src/paths.js')
  codec = await import('../src/zip.js')
  table = routes.createNexusRoutes()
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Fake req/res harness                                                */
/* ------------------------------------------------------------------ */

interface CallInit {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: Buffer | string
  remoteAddress?: string
}

interface CallResult {
  status: number
  headers: Record<string, string>
  raw: string
}

interface Envelope {
  data?: unknown
  error?: string
  hotReload?: string
}

async function call(path: string, init: CallInit = {}): Promise<CallResult> {
  const spec = table.find((s) => s.path === path)
  assert.ok(spec, `no route spec for ${path}`)

  const listeners: Record<string, Array<(arg?: unknown) => void>> = {}
  const req = {
    method: init.method ?? 'GET',
    url: init.url ?? path,
    headers: init.headers ?? {},
    socket: { remoteAddress: init.remoteAddress ?? '127.0.0.1' },
    on(event: string, cb: (arg?: unknown) => void) {
      ;(listeners[event] ??= []).push(cb)
      return req
    },
  } as unknown as RouteRequest

  const captured = { status: 0, headers: {} as Record<string, string>, raw: '' }
  const res: RouteResponse = {
    writeHead(status, headers) {
      captured.status = status
      Object.assign(captured.headers, headers)
    },
    end(chunk) {
      captured.raw = chunk ?? ''
    },
  }

  const done = Promise.resolve(spec.handler(req, res))
  if (init.body !== undefined) {
    const buf = Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body)
    for (const cb of listeners.data ?? []) cb(buf)
  }
  for (const cb of listeners.end ?? []) cb()
  await done
  return { status: captured.status, headers: captured.headers, raw: captured.raw }
}

function envelope(result: CallResult): Envelope {
  assert.ok(result.raw.length > 0, 'response carries a body')
  return JSON.parse(result.raw) as Envelope
}

function dataOf<T>(result: CallResult): T {
  const env = envelope(result)
  assert.ok('data' in env, 'envelope carries data')
  return env.data as T
}

function errorsOf(result: CallResult): { error?: string; data: Record<string, unknown> } {
  const env = envelope(result)
  return { error: env.error, data: (env.data ?? {}) as Record<string, unknown> }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const skillMd = (name: string, description = `${name} demo skill`): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

/** Drop every manifest entry so whole-state assertions (list) start empty. */
async function clearEntries(): Promise<void> {
  for (const s of (await manifest.readManifest()).skills) await manifest.removeEntry(s.name)
}

/** Manifest entry + a local clone dir carrying one valid SKILL.md. */
async function seedClone(name: string, extra: Partial<SkillEntry> = {}): Promise<string> {
  await manifest.addEntry({
    name,
    url: `github:owner/${name}`,
    gitUrl: `https://github.com/owner/${name}.git`,
    ref: 'main',
    path: name,
    addedAt: new Date().toISOString(),
    ...extra,
  })
  const dir = paths.repoDir(name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), skillMd(name), 'utf8')
  return dir
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Let pending microtasks settle (flight-slot release is promise-based). */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Poll the job registry until the job leaves `running`. */
async function waitForJob(id: string, timeoutMs = 5000): Promise<Job> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = jobs.getJob(id)
    assert.ok(job, `job ${id} exists`)
    if (job.status !== 'running') return job
    assert.ok(Date.now() < deadline, `job ${id} finished within ${timeoutMs}ms`)
    await sleep(25)
  }
}

/* ------------------------------------------------------------------ */
/* Envelope + method gating                                            */
/* ------------------------------------------------------------------ */

test('ping answers 200 with the permanent Phase 0 payload', async () => {
  const res = await call('/skills-nexus/ping')
  assert.equal(res.status, 200)
  const data = dataOf<{ name: string; status: string; now: string }>(res)
  assert.equal(data.name, 'dsh-skills-nexus')
  assert.equal(data.status, 'ok')
  assert.equal(envelope(res).hotReload, 'done')
  assert.ok(!Number.isNaN(Date.parse(data.now)))
})

test('wrong methods answer 405 with the allow header', async () => {
  const onList = await call('/skills-nexus/list', { method: 'POST' })
  assert.equal(onList.status, 405)
  assert.equal(onList.headers.allow, 'GET')
  assert.ok(errorsOf(onList).error)

  const onRemove = await call('/skills-nexus/remove', { method: 'GET' })
  assert.equal(onRemove.status, 405)
  assert.equal(onRemove.headers.allow, 'POST')
})

test('a malformed JSON body answers 400 invalid-json', async () => {
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    body: '{nope',
  })
  assert.equal(res.status, 400)
  assert.equal(errorsOf(res).error, 'invalid-json')
})

/* ------------------------------------------------------------------ */
/* GET /list                                                           */
/* ------------------------------------------------------------------ */

test('list answers an empty manifest with an empty entry array', async () => {
  await clearEntries()
  const res = await call('/skills-nexus/list')
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf<{ entries: unknown[] }>(res).entries, [])
  assert.equal(envelope(res).hotReload, 'done')
})

test('list reports derived link state and runtime nulls per entry', async () => {
  await clearEntries()
  const alphaDir = await seedClone('list-alpha')
  await link.linkSkill('list-alpha', alphaDir)
  // The second entry records no remote (a snapshot): the payload has to say so,
  // because that is what the panel gates update/switch-version on.
  await manifest.addEntry({
    name: 'list-beta',
    url: 'package:snapshot.zip',
    gitUrl: '',
    ref: '',
    path: 'list-beta',
    addedAt: new Date().toISOString(),
  })

  const res = await call('/skills-nexus/list')
  assert.equal(res.status, 200)
  const { entries } = dataOf<{ entries: unknown[] }>(res) as { entries: unknown[] }
  assert.deepEqual(entries[0], {
    name: 'list-alpha',
    url: 'github:owner/list-alpha',
    ref: 'main',
    subdir: null,
    commit: null,
    hasGitSource: true,
    enabled: true,
    links: [{ linkName: 'list-alpha', skillName: 'list-alpha', enabled: true }],
    update: null,
  })
  assert.deepEqual(entries[1], {
    name: 'list-beta',
    url: 'package:snapshot.zip',
    ref: '',
    subdir: null,
    commit: null,
    hasGitSource: false,
    enabled: false,
    links: [],
    update: null,
  })
})

/* ------------------------------------------------------------------ */
/* GET /doctor                                                         */
/* ------------------------------------------------------------------ */

test('doctor answers the stable report v1 with external-disabled appended last', async () => {
  const res = await call('/skills-nexus/doctor')
  assert.equal(res.status, 200)
  const report = dataOf<{
    version: number
    checks: Array<{ id: string; issues: unknown[] }>
    summary: Record<string, number>
  }>(res)
  assert.equal(report.version, 1)
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ['manifest', 'roots', 'symlinks', 'orphan-repo', 'orphan-link', 'git-sanity', 'external-disabled'],
  )
  assert.equal(typeof report.summary.errors, 'number')
  assert.equal(typeof report.summary.warnings, 'number')
  assert.equal(envelope(res).hotReload, 'done')
})

/* ------------------------------------------------------------------ */
/* GET /job + POST /job/cancel                                         */
/* ------------------------------------------------------------------ */

test('job status validates the id parameter', async () => {
  const missing = await call('/skills-nexus/job')
  assert.equal(missing.status, 400)
  assert.equal(errorsOf(missing).error, 'missing-field')

  const unknown = await call('/skills-nexus/job', { url: '/skills-nexus/job?id=nope' })
  assert.equal(unknown.status, 404)
})

test('job cancel answers 404 for an unknown id', async () => {
  const res = await call('/skills-nexus/job/cancel', {
    method: 'POST',
    body: JSON.stringify({ id: 'nope' }),
  })
  assert.equal(res.status, 404)
})

/* ------------------------------------------------------------------ */
/* POST /remove                                                        */
/* ------------------------------------------------------------------ */

test('remove requires an explicit confirmation (409 confirm-required)', async () => {
  await seedClone('rm-skill')
  await link.linkSkill('rm-skill', paths.repoDir('rm-skill'))

  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    body: JSON.stringify({ name: 'rm-skill' }),
  })
  assert.equal(res.status, 409)
  const { error, data } = errorsOf(res)
  assert.equal(error, 'confirm-required')
  assert.ok(String(data.question).includes('Remove "rm-skill"'))
  assert.ok(await exists(paths.skillLinkPath('rm-skill')))
})

test('remove rejects a cross-origin request before reading the body (403)', async () => {
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
    body: JSON.stringify({ name: 'rm-skill', confirm: true }),
  })
  assert.equal(res.status, 403)
  assert.ok(await exists(paths.skillLinkPath('rm-skill')))
})

test('remove rejects non-loopback sockets with 403', async () => {
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    remoteAddress: '10.0.0.5',
    body: JSON.stringify({ name: 'rm-skill', confirm: true }),
  })
  assert.equal(res.status, 403)
  assert.equal(errorsOf(res).error, 'loopback only')
})

test('remove answers 404 for an unknown name', async () => {
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    body: JSON.stringify({ name: 'nope-skill', confirm: true }),
  })
  assert.equal(res.status, 404)
})

test('remove deletes the clone, every attributed link and the registration', async () => {
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    body: JSON.stringify({ name: 'rm-skill', confirm: true }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf(res), { name: 'rm-skill', removed: true, links: ['rm-skill'] })
  assert.equal(envelope(res).hotReload, 'pending')

  const after = await manifest.readManifest()
  assert.equal(manifest.findEntry(after, 'rm-skill'), undefined)
  assert.ok(!(await exists(paths.skillLinkPath('rm-skill'))))
  assert.ok(!(await exists(paths.repoDir('rm-skill'))))
})

test('remove without links answers hotReload done (no watcher event)', async () => {
  await seedClone('rm-bare')
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    body: JSON.stringify({ name: 'rm-bare', confirm: true }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf(res), { name: 'rm-bare', removed: true, links: [] })
  assert.equal(envelope(res).hotReload, 'done')
})

/* ------------------------------------------------------------------ */
/* POST /toggle (§6.4 target attribution)                              */
/* ------------------------------------------------------------------ */

test('toggle validates name and enabled', async () => {
  await seedClone('tog-a')
  const noEnabled = await call('/skills-nexus/toggle', {
    method: 'POST',
    body: JSON.stringify({ name: 'tog-a' }),
  })
  assert.equal(noEnabled.status, 400)
  assert.equal(errorsOf(noEnabled).data.field, 'enabled')

  const unknown = await call('/skills-nexus/toggle', {
    method: 'POST',
    body: JSON.stringify({ name: 'nope-skill', enabled: false }),
  })
  assert.equal(unknown.status, 404)
})

test('toggle disable removes every link attributed by target', async () => {
  const dir = paths.repoDir('tog-a')
  // A second link with a name that is NOT the entry name — attribution is by
  // readlink target, so disable must remove both.
  await link.linkSkill('tog-a', dir)
  await link.linkSkill('tog-a-alias', dir)

  const res = await call('/skills-nexus/toggle', {
    method: 'POST',
    body: JSON.stringify({ name: 'tog-a', enabled: false }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf(res), { name: 'tog-a', enabled: false, links: [] })
  assert.equal(envelope(res).hotReload, 'pending')
  assert.ok(!(await exists(paths.skillLinkPath('tog-a'))))
  assert.ok(!(await exists(paths.skillLinkPath('tog-a-alias'))))
})

test('toggle enable rebuilds only the missing links', async () => {
  const res = await call('/skills-nexus/toggle', {
    method: 'POST',
    body: JSON.stringify({ name: 'tog-a', enabled: true }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf(res), {
    name: 'tog-a',
    enabled: true,
    links: [{ linkName: 'tog-a', enabled: true }],
  })
  assert.equal(envelope(res).hotReload, 'pending')
  assert.ok(await exists(paths.skillLinkPath('tog-a')))
  // The alias link was not resurrected — enable fills in missing links only.
  assert.ok(!(await exists(paths.skillLinkPath('tog-a-alias'))))
})

test('toggle enable refuses a real directory collision with 409', async () => {
  await seedClone('tog-col')
  const colliding = paths.skillLinkPath('tog-col')
  await mkdir(colliding, { recursive: true })
  try {
    const res = await call('/skills-nexus/toggle', {
      method: 'POST',
      body: JSON.stringify({ name: 'tog-col', enabled: true }),
    })
    assert.equal(res.status, 409)
    const { error, data } = errorsOf(res)
    assert.equal(error, 'collision')
    assert.equal(data.name, 'tog-col')
  } finally {
    await rm(colliding, { recursive: true, force: true })
  }
})

test('a no-op disable (no links to remove) answers hotReload done', async () => {
  await seedClone('tog-bare')
  const res = await call('/skills-nexus/toggle', {
    method: 'POST',
    body: JSON.stringify({ name: 'tog-bare', enabled: false }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf(res), { name: 'tog-bare', enabled: false, links: [] })
  assert.equal(envelope(res).hotReload, 'done')
})

test('a no-op enable (links already present) answers hotReload done', async () => {
  await seedClone('tog-keep')
  await link.linkSkill('tog-keep', paths.repoDir('tog-keep'))
  const res = await call('/skills-nexus/toggle', {
    method: 'POST',
    body: JSON.stringify({ name: 'tog-keep', enabled: true }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(dataOf(res), {
    name: 'tog-keep',
    enabled: true,
    links: [{ linkName: 'tog-keep', enabled: true }],
  })
  assert.equal(envelope(res).hotReload, 'done')
})

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* POST /add (pre-flight only, plus one local-clone happy path)        */
/* ------------------------------------------------------------------ */

test('add requires a url field (400)', async () => {
  const res = await call('/skills-nexus/add', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  assert.equal(res.status, 400)
  assert.equal(errorsOf(res).data.field, 'url')
})

test('add rejects a duplicate registration before any clone (409 already-registered)', async () => {
  await seedClone('dup-skill')
  const res = await call('/skills-nexus/add', {
    method: 'POST',
    body: JSON.stringify({ url: 'github:owner/dup-skill' }),
  })
  assert.equal(res.status, 409)
  const { error, data } = errorsOf(res)
  assert.equal(error, 'already-registered')
  assert.equal(data.name, 'dup-skill')
})

test('add rejects a skills-root collision with 409', async () => {
  const colliding = paths.skillLinkPath('col-skill')
  await mkdir(colliding, { recursive: true })
  try {
    const res = await call('/skills-nexus/add', {
      method: 'POST',
      body: JSON.stringify({ url: 'github:owner/col-skill' }),
    })
    assert.equal(res.status, 409)
    const { error, data } = errorsOf(res)
    assert.equal(error, 'collision')
    assert.equal(data.name, 'col-skill')
  } finally {
    await rm(colliding, { recursive: true, force: true })
  }
})

test('add rejects a cross-origin request with 403', async () => {
  const res = await call('/skills-nexus/add', {
    method: 'POST',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
    body: JSON.stringify({ url: 'github:owner/x' }),
  })
  assert.equal(res.status, 403)
})

test('an accepted add reports its clone stage on the job record (no spinner bytes)', async () => {
  // The install phase is the shared core (§10.1) and its progress indicator is
  // the caller's `io.spin`; a polled job record must receive the stage, never
  // the CLI's `\r`-animated spinner. This is the one case that runs the job to
  // completion, so it is also the closest thing to an end-to-end install here —
  // a local `file://` repo, so nothing touches the network.
  const src = join(home, 'src-api-add')
  await mkdir(src, { recursive: true })
  const git = (args: string[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      execFile('git', args, { cwd: src }, (err) => (err ? reject(err) : resolve(undefined)))
    })
  await git(['init'])
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(['config', 'user.email', 'test@example.com'])
  await git(['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'SKILL.md'), skillMd('src-api-add'), 'utf8')
  await git(['add', '.'])
  await git(['commit', '-m', 'skill'])

  const accepted = await call('/skills-nexus/add', {
    method: 'POST',
    body: JSON.stringify({ url: 'file:///' + src.replaceAll('\\', '/') }),
  })
  assert.equal(accepted.status, 202)
  const { jobId } = dataOf<{ jobId: string }>(accepted)
  const job = await waitForJob(jobId)

  assert.equal(job.status, 'done', job.error ?? '')
  // The stage the pre-unification mirror set, preserved through the seam.
  assert.equal(job.stage, 'cloning')
  assert.equal(job.detail, 'main')
  assert.ok(job.output.some((l) => l.startsWith('Cloning ')), 'the clone line is recorded')
  for (const line of job.output) {
    assert.doesNotMatch(line, /[\r\x1b]/, 'no spinner control bytes in a polled record')
  }
})

/* ------------------------------------------------------------------ */
/* POST /update                                                        */
/* ------------------------------------------------------------------ */

test('update requires confirmation and an existing entry (409/404)', async () => {
  await seedClone('up-git')
  const noConfirm = await call('/skills-nexus/update', {
    method: 'POST',
    body: JSON.stringify({ name: 'up-git' }),
  })
  assert.equal(noConfirm.status, 409)
  assert.equal(errorsOf(noConfirm).error, 'confirm-required')

  const unknown = await call('/skills-nexus/update', {
    method: 'POST',
    body: JSON.stringify({ name: 'nope-update', confirm: true }),
  })
  assert.equal(unknown.status, 404)
})

test('update refuses an entry with no git source with 400 not-a-git-clone', async () => {
  await seedClone('up-snapshot', { gitUrl: '', ref: '' })
  const res = await call('/skills-nexus/update', {
    method: 'POST',
    body: JSON.stringify({ name: 'up-snapshot', confirm: true }),
  })
  assert.equal(res.status, 400)
  assert.equal(errorsOf(res).error, 'not-a-git-clone')
})

test('update answers 409 busy while the skill flight is held', async () => {
  await seedClone('busy-skill')
  const release = locks.tryClaimSkillFlight('busy-skill')
  assert.ok(release, 'flight slot is free before the test')
  try {
    const res = await call('/skills-nexus/update', {
      method: 'POST',
      body: JSON.stringify({ name: 'busy-skill', confirm: true }),
    })
    assert.equal(res.status, 409)
    const { error, data } = errorsOf(res)
    assert.equal(error, 'busy')
    assert.equal(data.name, 'busy-skill')
  } finally {
    release()
  }
  await flush()
  const again = locks.tryClaimSkillFlight('busy-skill')
  assert.ok(again, 'the flight slot was released')
  again()
})

test('update answers 409 locked while the lock file is held', async () => {
  await seedClone('locked-skill')
  const held = await locks.acquireSkillFileLock('locked-skill')
  try {
    const res = await call('/skills-nexus/update', {
      method: 'POST',
      body: JSON.stringify({ name: 'locked-skill', confirm: true }),
    })
    assert.equal(res.status, 409)
    const { error, data } = errorsOf(res)
    assert.equal(error, 'locked')
    const lock = data.lock as { pid: number; startedAt: string }
    assert.equal(lock.pid, process.pid)
  } finally {
    await held.release()
  }
  // The acceptance path claimed the flight before the lock failed — the
  // failure must have released it again.
  await flush()
  const again = locks.tryClaimSkillFlight('locked-skill')
  assert.ok(again, 'the flight slot was released after the lock failure')
  again()
})

/* ------------------------------------------------------------------ */
/* POST /switch-version                                                */
/* ------------------------------------------------------------------ */

test('switch-version validates ref and refType (400)', async () => {
  const noRef = await call('/skills-nexus/switch-version', {
    method: 'POST',
    body: JSON.stringify({ name: 'x' }),
  })
  assert.equal(noRef.status, 400)
  assert.equal(errorsOf(noRef).data.field, 'ref')

  const badType = await call('/skills-nexus/switch-version', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', ref: 'v1.0.0', refType: 'weird' }),
  })
  assert.equal(badType.status, 400)
  assert.equal(errorsOf(badType).error, 'invalid-ref-type')
})

test('switch-version requires confirmation and refuses source-less entries (409/400)', async () => {
  const noConfirm = await call('/skills-nexus/switch-version', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', ref: 'v1.0.0' }),
  })
  assert.equal(noConfirm.status, 409)
  assert.equal(errorsOf(noConfirm).error, 'confirm-required')

  // `up-snapshot` was registered without a remote by the update test above.
  const sourceLess = await call('/skills-nexus/switch-version', {
    method: 'POST',
    body: JSON.stringify({ name: 'up-snapshot', ref: 'v1.0.0', confirm: true }),
  })
  assert.equal(sourceLess.status, 400)
  assert.equal(errorsOf(sourceLess).error, 'not-a-git-clone')
})

/* ------------------------------------------------------------------ */
/* POST /check-updates                                                 */
/* ------------------------------------------------------------------ */

test('check-updates rejects a cross-origin request before any network (403)', async () => {
  const res = await call('/skills-nexus/check-updates', {
    method: 'POST',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
    body: JSON.stringify({}),
  })
  assert.equal(res.status, 403)
  assert.equal(errorsOf(res).error, 'untrusted origin')
})

/* ------------------------------------------------------------------ */
/* POST /add-zip — retired                                             */
/* ------------------------------------------------------------------ */

test('the add-zip route is gone: zip is not an installation method any more', () => {
  // §8 phase 3: the route, its hand-written multipart reader and the
  // `installFromZip` orchestration behind it were deleted together. Pinned as
  // an absence so a later refactor cannot quietly bring the upload path back;
  // the panel row it occupied is where `import` lives now (§10.3).
  assert.equal(
    table.some((s) => s.path === '/skills-nexus/add-zip'),
    false,
    'no route may answer /skills-nexus/add-zip',
  )
  // The package channel took that row over with exactly two routes (import and
  // the adopt action), so the table is 11 + 2 — and the upload path itself is a
  // raw body, not a restored multipart endpoint.
  assert.equal(table.length, 13, 'the §7.1 table plus the two §10.3 routes')
  assert.deepEqual(
    table.filter((s) => s.path.startsWith('/skills-nexus/import')).map((s) => s.path),
    ['/skills-nexus/import'],
  )
  assert.ok(table.some((s) => s.path === '/skills-nexus/adopt'))
})

/* ------------------------------------------------------------------ */
/* POST /import — the package channel (§10.3)                          */
/* ------------------------------------------------------------------ */

/** A minimal bare package: one skill at the root, no `nexus-package.json`. */
function barePackage(skillName: string): Buffer {
  return codec.createZip([
    { name: 'SKILL.md', data: Buffer.from(skillMd(skillName), 'utf8') },
  ])
}

/** A labelled package: `nexus-package.json` (§5) + the payload it describes. */
function labelledPackage(entryName: string, gitUrl: string): Buffer {
  const label = {
    schema: 'dsh-skills-nexus/package',
    version: 1,
    exportedAt: '2026-10-02T00:00:00.000Z',
    generator: 'dsh-skills-nexus@test',
    skipped: [],
    entries: [
      {
        name: entryName,
        url: gitUrl,
        gitUrl,
        ref: 'main',
        commit: '',
        enabled: true,
        skills: [{ name: entryName, description: 'demo', root: `${entryName}`, links: [entryName] }],
      },
    ],
  }
  return codec.createZip([
    { name: 'nexus-package.json', data: Buffer.from(JSON.stringify(label), 'utf8') },
    { name: `skills/${entryName}/SKILL.md`, data: Buffer.from(skillMd(entryName), 'utf8') },
  ])
}

test('import requires the package bytes (400 missing-field)', async () => {
  const res = await call('/skills-nexus/import', {
    method: 'POST',
    url: '/skills-nexus/import?dryRun=true',
  })
  assert.equal(res.status, 400)
  assert.equal(errorsOf(res).error, 'missing-field')
  assert.equal(errorsOf(res).data.field, 'package')
})

test('import rejects a cross-origin request before reading the body (403)', async () => {
  const res = await call('/skills-nexus/import', {
    method: 'POST',
    url: '/skills-nexus/import?dryRun=true',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
    body: barePackage('x'),
  })
  assert.equal(res.status, 403)
  assert.equal(errorsOf(res).error, 'untrusted origin')
})

test('import dry-run answers the plan synchronously and changes nothing', async () => {
  await clearEntries()
  const res = await call('/skills-nexus/import', {
    method: 'POST',
    // `noNetCheck` keeps the verdict deterministic (and offline): a bare
    // package has no label to probe anyway, but the flag pins the reason.
    url: '/skills-nexus/import?dryRun=true&noNetCheck=true',
    headers: { 'x-nexus-filename': 'third-party.ZIP' },
    body: barePackage('api-import-bare'),
  })
  assert.equal(res.status, 200)
  const { plan } = dataOf<{ plan: ImportPlanView }>(res)
  assert.equal(plan.labelled, false)
  assert.equal(plan.entries.length, 1)
  // A bare package names its entry after the uploaded file — so the filename
  // travels outside the body and reaches the plan intact (§10.2's `package:`
  // line is the name the user recognises), only sanitized into kebab-case.
  assert.equal(plan.entries[0]!.name, 'third-party')
  assert.match(plan.source, /third-party\.ZIP$/)
  // §10.2 verdict: no label at all → snapshot, and never "unreachable" (there
  // is no url to have failed to reach).
  assert.equal(plan.entries[0]!.decision.kind, 'snapshot')
  assert.equal(plan.entries[0]!.decision.reason, 'no-source')

  // The preview must not have registered anything, and the temporary upload
  // must be gone — a dry run leaves no server-side state at all.
  assert.deepEqual((await manifest.readManifest()).skills, [])
  const uploaded = (await readdir(paths.NEXUS_HOME)).filter((f) => f.startsWith('upload-'))
  assert.deepEqual(uploaded, [])
  // …and it never took the per-entry flight, so a following operation can.
  const release = locks.tryClaimSkillFlight('third-party')
  assert.ok(release, 'the dry run released (never took) the flight slot')
  release()
})

test('import dry-run reports a labelled package as not-checked, never unreachable', async () => {
  const res = await call('/skills-nexus/import', {
    method: 'POST',
    // The label records a remote; `--no-net-check` (offline mode) must report
    // "not checked", not a verdict it never obtained (§10.2).
    url: '/skills-nexus/import?dryRun=true&noNetCheck=true',
    headers: { 'x-nexus-filename': 'labelled.zip' },
    body: labelledPackage('api-import-labelled', 'github:owner/api-import-labelled'),
  })
  assert.equal(res.status, 200)
  const { plan } = dataOf<{ plan: ImportPlanView }>(res)
  assert.equal(plan.labelled, true)
  assert.equal(plan.entries.length, 1)
  assert.equal(plan.entries[0]!.name, 'api-import-labelled')
  assert.equal(plan.entries[0]!.decision.kind, 'snapshot')
  assert.equal(plan.entries[0]!.decision.reason, 'not-checked')
  assert.deepEqual((await manifest.readManifest()).skills, [])
})

test('import refused a run without confirm (409) and registers nothing', async () => {
  const res = await call('/skills-nexus/import', {
    method: 'POST',
    url: '/skills-nexus/import?noNetCheck=true',
    headers: { 'x-nexus-filename': 'unconfirmed.zip' },
    body: barePackage('api-import-noconfirm'),
  })
  assert.equal(res.status, 409)
  const { error, data } = errorsOf(res)
  assert.equal(error, 'confirm-required')
  assert.match(String(data.question), /Import the package "unconfirmed\.zip"/)
  assert.deepEqual((await manifest.readManifest()).skills, [])})

test('import with confirm lands the package as a snapshot (202 + job)', async () => {
  await clearEntries()
  const accepted = await call('/skills-nexus/import', {
    method: 'POST',
    url: '/skills-nexus/import?confirm=true&noNetCheck=true',
    headers: { 'x-nexus-filename': 'api-import-snap.zip' },
    body: barePackage('api-import-snap'),
  })
  assert.equal(accepted.status, 202)
  const { jobId } = dataOf<{ jobId: string }>(accepted)
  const job = await waitForJob(jobId)

  assert.equal(job.status, 'done', job.error ?? '')
  assert.equal(job.kind, 'import')
  // A package without a label names its entry after the file (peel-scan rule),
  // so the uploaded basename has to survive staging.
  const entry = manifest.findEntry(await manifest.readManifest(), 'api-import-snap')
  assert.ok(entry, 'the entry was registered under the package name')
  // No label → snapshot: no git source to update from (§10.2).
  assert.equal(manifest.hasGitSource(entry), false)
  assert.ok(await exists(paths.repoDir('api-import-snap')))
  assert.equal(await link.isLinked('api-import-snap'), true)
  // A job that registers and links wakes the host watcher.
  assert.ok(job.output.some((l) => l.includes('api-import-snap')))
  const uploaded = (await readdir(paths.NEXUS_HOME)).filter((f) => f.startsWith('upload-'))
  assert.deepEqual(uploaded, [], 'the uploaded temporary directory was cleaned up')
})

/* ------------------------------------------------------------------ */
/* POST /adopt — attach a source to a snapshot (§10.3)                 */
/* ------------------------------------------------------------------ */

test('adopt validates name and url before anything else (400)', async () => {
  const noName = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ url: 'github:owner/x' }),
  })
  assert.equal(noName.status, 400)
  assert.equal(errorsOf(noName).data.field, 'name')

  const noUrl = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'x' }),
  })
  assert.equal(noUrl.status, 400)
  assert.equal(errorsOf(noUrl).data.field, 'url')
})

test('adopt rejects a cross-origin request (403)', async () => {
  const res = await call('/skills-nexus/adopt', {
    method: 'POST',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
    body: JSON.stringify({ name: 'x', url: 'github:owner/x', confirm: true }),
  })
  assert.equal(res.status, 403)
})

test('adopt answers 404 for an unknown entry and 409 without confirmation', async () => {
  await seedClone('ad-snapshot', { gitUrl: '', ref: '' })
  const unknown = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'nope-adopt', url: 'github:owner/x', confirm: true }),
  })
  assert.equal(unknown.status, 404)
  assert.equal(errorsOf(unknown).error, 'not-found')

  const noConfirm = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'ad-snapshot', url: 'github:owner/x' }),
  })
  assert.equal(noConfirm.status, 409)
  assert.equal(errorsOf(noConfirm).error, 'confirm-required')
})

test('adopt refuses an external entry with 409 external-entry', async () => {
  await seedClone('ad-external', { gitUrl: '', ref: '', ownership: 'external' })
  const res = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'ad-external', url: 'github:owner/x', confirm: true }),
  })
  assert.equal(res.status, 409)
  const { error, data } = errorsOf(res)
  assert.equal(error, 'external-entry')
  // §2.1: nexus must not touch a directory the user owns — the message says so
  // and the clone directory is still exactly where it was.
  assert.match(String(data.message), /directory you own/)
  assert.ok(await exists(paths.repoDir('ad-external')))
})

test('adopt maps a bad url to 400 invalid-url before any clone', async () => {
  await seedClone('ad-badurl', { gitUrl: '', ref: '' })
  const res = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'ad-badurl', url: 'ext::sh -c echo', confirm: true }),
  })
  // `ext::` is Git's remote-ext transport — the core refuses it as an unsafe
  // spec, and the route decides that *before* the 202 (a job error would only
  // reach the client as an untyped message).
  assert.equal(res.status, 400)
  const { error, data } = errorsOf(res)
  assert.equal(error, 'invalid-url')
  assert.match(String(data.message), /Invalid repo spec/)
})

/* ------------------------------------------------------------------ */
/* Job channel (registry-level determinism for cancel / confirm)       */
/* ------------------------------------------------------------------ */

test('a cancelled job stops at the next io boundary (status cancelled)', async () => {
  const job = jobs.createJob('update', 'job-cancel-skill')
  jobs.requestCancel(job.id)
  let released = 0
  jobs.runJob(
    job,
    async () => {
      released++
    },
    async (io) => {
      io.progress('working')
    },
  )

  const settled = await waitForJob(job.id)
  assert.equal(settled.status, 'cancelled')
  assert.ok(settled.endedAt)
  assert.equal(released, 1)
})

test('a confirm inside a job surfaces as a needs-confirm error', async () => {
  const job = jobs.createJob('add', 'job-confirm-skill')
  jobs.runJob(
    job,
    async () => undefined,
    async (io) => {
      await io.confirm('Proceed?', false)
    },
  )

  const settled = await waitForJob(job.id)
  assert.equal(settled.status, 'error')
  assert.equal(settled.error, 'confirmation required: Proceed?')
})

test('the job release callback runs exactly once after a failure', async () => {
  const job = jobs.createJob('switch-version', 'job-fail-skill')
  let released = 0
  jobs.runJob(
    job,
    async () => {
      released++
    },
    async () => {
      throw new Error('boom')
    },
  )

  const settled = await waitForJob(job.id)
  assert.equal(settled.status, 'error')
  assert.equal(settled.error, 'boom')
  assert.equal(released, 1)
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
 * Nothing here may touch the network: the network cores (add / update /
 * switch-version jobs, check-updates) are exercised only through pre-flight
 * branches that throw before any git call. The one real job in this file is
 * the add-zip upload, which is pure local filesystem work.
 */

let home: string
let table: RouteSpec[]
let routes: typeof import('../src/http/routes.js')
let manifest: typeof import('../src/manifest.js')
let link: typeof import('../src/link.js')
let jobs: typeof import('../src/http/jobs.js')
let locks: typeof import('../src/locks.js')
let paths: typeof import('../src/paths.js')

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
/* Zip + multipart builders (stored entries; CRCs are not verified)    */
/* ------------------------------------------------------------------ */

function storedZip(files: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const f of files) {
    const data = Buffer.from(f.data, 'utf8')
    const name = Buffer.from(f.name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, data)
    centrals.push(central, name)
    offset += 30 + name.length + data.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)
  return Buffer.concat([localPart, centralPart, eocd])
}

function multipartBody(boundary: string, fileName: string, file: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `content-disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      'content-type: application/zip\r\n\r\n',
    'latin1',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1')
  return Buffer.concat([head, file, tail])
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
  await manifest.addEntry({
    name: 'list-beta',
    url: 'github:owner/list-beta',
    gitUrl: 'https://github.com/owner/list-beta.git',
    ref: 'main',
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
    source: 'git',
    enabled: true,
    links: [{ linkName: 'list-alpha', skillName: 'list-alpha', enabled: true }],
    update: null,
  })
  assert.deepEqual(entries[1], {
    name: 'list-beta',
    url: 'github:owner/list-beta',
    ref: 'main',
    subdir: null,
    commit: null,
    source: 'git',
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
/* POST /add (pre-flight only — no clone is ever started here)         */
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

test('update refuses zip-installed entries with 400 zip-not-updatable', async () => {
  await seedClone('up-zip', { source: 'zip', gitUrl: '', ref: '' })
  const res = await call('/skills-nexus/update', {
    method: 'POST',
    body: JSON.stringify({ name: 'up-zip', confirm: true }),
  })
  assert.equal(res.status, 400)
  assert.equal(errorsOf(res).error, 'zip-not-updatable')
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

test('switch-version requires confirmation and refuses zip entries (409/400)', async () => {
  const noConfirm = await call('/skills-nexus/switch-version', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', ref: 'v1.0.0' }),
  })
  assert.equal(noConfirm.status, 409)
  assert.equal(errorsOf(noConfirm).error, 'confirm-required')

  const zip = await call('/skills-nexus/switch-version', {
    method: 'POST',
    body: JSON.stringify({ name: 'up-zip', ref: 'v1.0.0', confirm: true }),
  })
  assert.equal(zip.status, 400)
  assert.equal(errorsOf(zip).error, 'zip-not-updatable')
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
/* POST /add-zip (multipart → 202 job → real local install)            */
/* ------------------------------------------------------------------ */

test('add-zip requires a multipart body (400)', async () => {
  const notMultipart = await call('/skills-nexus/add-zip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(notMultipart.status, 400)
  assert.equal(errorsOf(notMultipart).error, 'multipart-required')

  const noFile = await call('/skills-nexus/add-zip', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=ZZ' },
    body: 'hello',
  })
  assert.equal(noFile.status, 400)
})

test('add-zip accepts an upload as a 202 job and installs it', async () => {
  const boundary = 'NEXUSBOUNDARY'
  const zip = storedZip([{ name: 'zipkit/SKILL.md', data: skillMd('zipkit') }])
  const res = await call('/skills-nexus/add-zip', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: multipartBody(boundary, 'zipkit.zip', zip),
  })

  // The async-acceptance envelope is exactly `202 { data: { jobId } }`.
  assert.equal(res.status, 202)
  const env = envelope(res)
  assert.deepEqual(Object.keys(env), ['data'])
  assert.deepEqual(Object.keys(env.data as object), ['jobId'])
  const { jobId } = env.data as { jobId: string }

  const job = await waitForJob(jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.kind, 'add-zip')
  assert.ok(job.output.some((line) => line.includes('Installed zip entry "zipkit"')))

  // Registered from the upload: source zip, linked into the official root.
  const entry = manifest.findEntry(await manifest.readManifest(), 'zipkit')
  assert.ok(entry)
  assert.equal(entry.source, 'zip')
  assert.ok(await exists(paths.skillLinkPath('zipkit')))

  const poll = await call('/skills-nexus/job', { url: `/skills-nexus/job?id=${jobId}` })
  assert.equal(poll.status, 200)
  assert.equal(dataOf<{ job: Job }>(poll).job.status, 'done')

  const cancel = await call('/skills-nexus/job/cancel', {
    method: 'POST',
    body: JSON.stringify({ id: jobId }),
  })
  assert.equal(cancel.status, 200)
  assert.equal(dataOf<{ id: string; status: string }>(cancel).status, 'done')
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

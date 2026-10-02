import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RouteRequest, RouteResponse, RouteSpec } from '../src/http/types.js'

/**
 * CLI ↔ plugin parity: one operation, one filesystem outcome.
 *
 * `update` exists twice — `src/cli/commands/update.ts` for the CLI and
 * `updateEntryCore` in `src/http/routes.ts` for the panel — as mirrored
 * implementations. This file drives the SAME scenario through both faces and
 * asserts the resulting link sets are structurally identical, so either side
 * drifting (e.g. one pruning the links upstream dropped and the other not)
 * turns the suite red instead of silently diverging.
 *
 * `remove` is the other half of that promise: both faces now call the one core
 * in `src/remove.ts`, and the remove case below pins the observable contract —
 * link names are *derived* from the clone's current skills, so a hand-made alias
 * pointing into it survives (attribution-based deletion would have taken it).
 * A face that goes back to attribution turns that assertion red.
 *
 * Remotes are local `file://` fixtures: no network.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var is set in `before()`
 * before the first dynamic import — a *static* import of the paths chain would
 * bind the real ~/.dsh instead (guarded by the assertion below).
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

/** Two-skill bundle: `<root>/alpha/SKILL.md` + `<root>/beta/SKILL.md`. */
async function makeBundledRepo(dir: string, alphaName: string, betaName: string): Promise<void> {
  await mkdir(join(dir, 'alpha'), { recursive: true })
  await mkdir(join(dir, 'beta'), { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'alpha', 'SKILL.md'), `---\nname: ${alphaName}\ndescription: a\n---\nv1\n`, 'utf8')
  await writeFile(join(dir, 'beta', 'SKILL.md'), `---\nname: ${betaName}\ndescription: b\n---\nv1\n`, 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'bundled'])
}

async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', message])
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

let home: string
let table: RouteSpec[]
let link: typeof import('../src/link.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let gitMod: typeof import('../src/git.js')
let updateCmd: typeof import('../src/cli/commands/update.js')
let removeCmd: typeof import('../src/cli/commands/remove.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-parity-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  link = await import('../src/link.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  gitMod = await import('../src/git.js')
  updateCmd = await import('../src/cli/commands/update.js')
  removeCmd = await import('../src/cli/commands/remove.js')
  const routes = await import('../src/http/routes.js')
  table = routes.createNexusRoutes()
  assert.ok(
    paths.OFFICIAL_SKILLS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.OFFICIAL_SKILLS_DIR}`,
  )
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Fake req/res harness (same shape as test/api.test.ts)               */
/* ------------------------------------------------------------------ */

interface CallInit {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
  remoteAddress?: string
}

interface CallResult {
  status: number
  raw: string
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

  const captured = { status: 0, raw: '' }
  const res: RouteResponse = {
    writeHead(status: number) {
      captured.status = status
    },
    end(chunk?: string) {
      captured.raw = chunk ?? ''
    },
  }

  const handler = Promise.resolve(spec.handler(req, res))
  if (init.body !== undefined) {
    const buf = Buffer.from(init.body)
    for (const cb of listeners.data ?? []) cb(buf)
  }
  for (const cb of listeners.end ?? []) cb()
  await handler
  return { status: captured.status, raw: captured.raw }
}

function dataOf<T>(result: CallResult): T {
  const env = JSON.parse(result.raw) as { data?: unknown }
  assert.ok('data' in env, 'envelope carries data')
  return env.data as T
}

interface JobView {
  id: string
  status: string
  error?: string
}

async function waitForJob(id: string, timeoutMs = 15_000): Promise<JobView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await call('/skills-nexus/job', { url: `/skills-nexus/job?id=${id}` })
    const job = dataOf<{ job: JobView }>(res).job
    if (job.status !== 'running') return job
    if (Date.now() >= deadline) throw new Error(`job ${id} still running`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Whole-repo install: clone + manifest entry + the links `add` would make. */
async function installBundled(
  name: string,
  src: string,
  alphaName: string,
  betaName: string,
): Promise<void> {
  const dest = paths.skillDir(name)
  await gitMod.cloneRepo(gitMod.parseGitSpec(`${fileUrl(src)}#main`), dest)
  await manifest.addEntry({
    name,
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'main',
    commit: await gitMod.getHeadCommit(src),
    path: name,
    addedAt: new Date().toISOString(),
  })
  await link.linkSkill(alphaName, join(dest, 'alpha'))
  await link.linkSkill(betaName, join(dest, 'beta'))
}

/** Link names the entry currently owns, sorted — the observable outcome. */
async function linkNames(entryName: string): Promise<string[]> {
  const m = await manifest.readManifest()
  const entry = m.skills.find((s) => s.name === entryName)
  assert.ok(entry, `entry ${entryName} exists`)
  return (await link.entryLinks(entry)).map((l) => l.name).sort()
}

/** Run the plugin face of `update` and wait for its job to settle. */
async function updateViaRoute(name: string): Promise<JobView> {
  const accepted = await call('/skills-nexus/update', {
    method: 'POST',
    body: JSON.stringify({ name, confirm: true }),
  })
  assert.equal(accepted.status, 202)
  const { jobId } = dataOf<{ jobId: string }>(accepted)
  return await waitForJob(jobId)
}

/** Replace the `-cli` / `-api` fixture marker so both sets are comparable. */
const normalize = (names: readonly string[], tag: string): string[] =>
  names.map((n) => n.replace(tag, '-TAG'))

/* ------------------------------------------------------------------ */
/* Parity                                                              */
/* ------------------------------------------------------------------ */

test('update renames upstream: CLI and the HTTP route derive identical link sets', async () => {
  const srcCli = join(home, 'src-parity-cli')
  const srcApi = join(home, 'src-parity-api')
  await mkdir(srcCli, { recursive: true })
  await mkdir(srcApi, { recursive: true })
  await makeBundledRepo(srcCli, 'alpha-cli', 'beta-cli')
  await makeBundledRepo(srcApi, 'alpha-api', 'beta-api')
  await installBundled('parity-cli', srcCli, 'alpha-cli', 'beta-cli')
  await installBundled('parity-api', srcApi, 'alpha-api', 'beta-api')

  assert.deepEqual(await linkNames('parity-cli'), ['alpha-cli', 'beta-cli'])
  assert.deepEqual(await linkNames('parity-api'), ['alpha-api', 'beta-api'])

  // The same upstream change on both sides: beta is renamed.
  await writeFile(join(srcCli, 'beta', 'SKILL.md'), '---\nname: beta-cli2\ndescription: b\n---\nv2\n', 'utf8')
  await commitAll(srcCli, 'rename beta')
  await writeFile(join(srcApi, 'beta', 'SKILL.md'), '---\nname: beta-api2\ndescription: b\n---\nv2\n', 'utf8')
  await commitAll(srcApi, 'rename beta')

  // CLI face …
  assert.equal(await updateCmd.update(['parity-cli']), 0)
  // … plugin face (202 + job channel).
  const settled = await updateViaRoute('parity-api')
  assert.equal(settled.status, 'done')

  const cliNames = await linkNames('parity-cli')
  const apiNames = await linkNames('parity-api')

  // Same outcome, modulo the fixture marker: the renamed link exists, the old
  // name is pruned. A side that forgot to prune would carry three names here.
  assert.deepEqual(cliNames, ['alpha-cli', 'beta-cli2'])
  assert.deepEqual(apiNames, ['alpha-api', 'beta-api2'])
  assert.deepEqual(normalize(cliNames, '-cli'), normalize(apiNames, '-api'))

  // Neither face may keep a link under the name upstream dropped.
  assert.equal(await link.isLinked('beta-cli'), false)
  assert.equal(await link.isLinked('beta-api'), false)
  assert.equal(await link.isLinked('beta-cli2'), true)
  assert.equal(await link.isLinked('beta-api2'), true)
})

test('update shrinks upstream to one skill: both faces relink under the entry name', async () => {
  const srcCli = join(home, 'src-shrink-cli')
  const srcApi = join(home, 'src-shrink-api')
  await mkdir(srcCli, { recursive: true })
  await mkdir(srcApi, { recursive: true })
  await makeBundledRepo(srcCli, 'alpha-sc', 'beta-sc')
  await makeBundledRepo(srcApi, 'alpha-sa', 'beta-sa')
  await installBundled('shrink-cli', srcCli, 'alpha-sc', 'beta-sc')
  await installBundled('shrink-api', srcApi, 'alpha-sa', 'beta-sa')

  // Upstream deletes the alpha skill on both sides.
  await rm(join(srcCli, 'alpha'), { recursive: true, force: true })
  await commitAll(srcCli, 'drop alpha')
  await rm(join(srcApi, 'alpha'), { recursive: true, force: true })
  await commitAll(srcApi, 'drop alpha')

  assert.equal(await updateCmd.update(['shrink-cli']), 0)
  const settled = await updateViaRoute('shrink-api')
  assert.equal(settled.status, 'done')

  // A single remaining skill is linked under the entry name (the §8.1 naming
  // rule), and the deleted skill's link is gone on both faces — not dangling.
  assert.deepEqual(await linkNames('shrink-cli'), ['shrink-cli'])
  assert.deepEqual(await linkNames('shrink-api'), ['shrink-api'])
  assert.equal(await link.isLinked('alpha-sc'), false)
  assert.equal(await link.isLinked('alpha-sa'), false)
  assert.equal(await link.isLinked('beta-sc'), false)
  assert.equal(await link.isLinked('beta-sa'), false)
})

test('remove: both faces delete the same derived links and keep a hand-made alias', async () => {
  const srcCli = join(home, 'src-remove-cli')
  const srcApi = join(home, 'src-remove-api')
  await mkdir(srcCli, { recursive: true })
  await mkdir(srcApi, { recursive: true })
  await makeBundledRepo(srcCli, 'alpha-rc', 'beta-rc')
  await makeBundledRepo(srcApi, 'alpha-ra', 'beta-ra')
  await installBundled('rm-cli', srcCli, 'alpha-rc', 'beta-rc')
  await installBundled('rm-api', srcApi, 'alpha-ra', 'beta-ra')

  // A link someone added by hand, pointing into each clone. The by-name scheme
  // derives names from the clone's skills and therefore leaves it alone;
  // attribution-based deletion would have removed it.
  await link.linkSkill('alias-rc', join(paths.skillDir('rm-cli'), 'alpha'))
  await link.linkSkill('alias-ra', join(paths.skillDir('rm-api'), 'alpha'))

  // CLI face — exact name, so no glob confirmation is involved.
  assert.equal(await removeCmd.remove(['rm-cli']), 0)
  // Plugin face — same operation through the route (sync, 200).
  const res = await call('/skills-nexus/remove', {
    method: 'POST',
    body: JSON.stringify({ name: 'rm-api', confirm: true }),
  })
  assert.equal(res.status, 200)
  const data = dataOf<{ name: string; removed: boolean; links: string[] }>(res)

  // Both faces deleted the two derived names …
  assert.deepEqual(data.links.slice().sort(), ['alpha-ra', 'beta-ra'])
  assert.equal(await link.isLinked('alpha-rc'), false)
  assert.equal(await link.isLinked('beta-rc'), false)
  assert.equal(await link.isLinked('alpha-ra'), false)
  assert.equal(await link.isLinked('beta-ra'), false)
  // … kept the hand-made alias on BOTH faces …
  assert.equal(await link.isLinked('alias-rc'), true)
  assert.equal(await link.isLinked('alias-ra'), true)
  // … and dropped both clone directories.
  await assert.rejects(stat(paths.skillDir('rm-cli')), { code: 'ENOENT' })
  await assert.rejects(stat(paths.skillDir('rm-api')), { code: 'ENOENT' })
})

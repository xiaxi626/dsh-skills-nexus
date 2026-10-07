import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
 * `add` is the third: §10.1 makes the install phase (`src/install.ts`) the one
 * implementation both faces call, so the CLONE-level outcomes must match field
 * for field and link for link. The route-side `400` codes are part of that
 * promise too — they are rebuilt from the shared core's `GitInstallResult.code`,
 * and the panel's five codes have no other test anywhere, so they are pinned
 * here as well (a wrong mapping would otherwise be invisible to the whole suite).
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
let addCmd: typeof import('../src/cli/commands/add.js')
let adoptCmd: typeof import('../src/cli/commands/adopt.js')

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
  addCmd = await import('../src/cli/commands/add.js')
  adoptCmd = await import('../src/cli/commands/adopt.js')
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

  const recovery = await import('../src/rollback.js')
  for (const tag of ['cli', 'api']) {
    const entry = manifest.findEntry(await manifest.readManifest(), `parity-${tag}`)!
    const point = await recovery.readRollbackPoint(entry)
    assert.ok(point)
    assert.notEqual(point.from.commit, point.to.commit)
    assert.equal(point.to.commit, await gitMod.getHeadCommit(paths.repoDir(entry.path)))
    assert.equal(point.from.headType, 'branch')
    assert.equal(point.to.branch, 'main')
    assert.deepEqual(point.from.links.map((l) => l.name), [`alpha-${tag}`, `beta-${tag}`])
    assert.deepEqual(point.to.links.map((l) => l.name), [`alpha-${tag}`, `beta-${tag}2`])
    await recovery.rollbackEntry(entry.name, { emit() {}, error() {}, progress() {}, confirm: async () => false, interactive: false })
    assert.deepEqual(await linkNames(entry.name), [`alpha-${tag}`, `beta-${tag}`])
  }
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

  const recovery = await import('../src/rollback.js')
  for (const [name, expected] of [['shrink-cli', ['alpha-sc', 'beta-sc']], ['shrink-api', ['alpha-sa', 'beta-sa']]] as const) {
    await recovery.rollbackEntry(name, { emit() {}, error() {}, progress() {}, confirm: async () => false, interactive: false })
    assert.deepEqual(await linkNames(name), expected)
  }
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

/* ------------------------------------------------------------------ */
/* add — install parity through the one shared core (§10.1)            */
/* ------------------------------------------------------------------ */

/** The `add` route, settled through the job channel (§7.5). */
async function addViaRoute(body: Record<string, unknown>): Promise<JobView> {
  const accepted = await call('/skills-nexus/add', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  assert.equal(accepted.status, 202, 'add is accepted as a job')
  const { jobId } = dataOf<{ jobId: string }>(accepted)
  return await waitForJob(jobId)
}

/**
 * The install phase is one shared core (§10.1), so both faces must produce the
 * same clone-level facts: same entry shape, same derived link set, same commit.
 * The fixture markers (`-cli` / `-api`) are normalized away before comparing.
 */
test('add: CLI and the HTTP route install into the same entry shape and link set', async () => {
  const srcCli = join(home, 'src-add-cli')
  const srcApi = join(home, 'src-add-api')
  await mkdir(srcCli, { recursive: true })
  await mkdir(srcApi, { recursive: true })
  // Same layout on both sides, one marker apart: `<root>/alpha/SKILL.md`.
  await makeBundledRepo(srcCli, 'alpha-add-cli', 'beta-add-cli')
  await makeBundledRepo(srcApi, 'alpha-add-api', 'beta-add-api')

  // No `#ref` and no `ref` field on either face → both must resolve the
  // remote's default branch themselves (§10.1's read-only preflight).
  // `--name` is used on both faces to prove the clone directory stays
  // repo-based (name does not rename the path under repos/).
  assert.equal(await addCmd.add([fileUrl(srcCli), '--name', 'named-cli']), 0)
  const settled = await addViaRoute({ url: fileUrl(srcApi), name: 'named-api' })
  assert.equal(settled.status, 'done', `route add failed: ${settled.error ?? ''}`)

  const cliEntry = manifest.findEntry(await manifest.readManifest(), 'named-cli')
  const apiEntry = manifest.findEntry(await manifest.readManifest(), 'named-api')
  assert.ok(cliEntry, 'CLI registered its entry')
  assert.ok(apiEntry, 'the route registered its entry')

  // Everything except the fixture-specific strings (name / url / path / clone
  // dir / timestamps) has to be identical — that is what "one core" means.
  // `url` / `gitUrl` record the spec verbatim, in URL form (`file:///C:/…`),
  // so the fixture roots are normalized with forward slashes before comparing.
  const slash = (p: string): string => p.replaceAll('\\', '/')
  const shape = (e: typeof cliEntry, tag: string): Record<string, unknown> => ({
    name: e.name.replace(tag, '-TAG'),
    url: e.url.replace(slash(srcCli), '<SRC>').replace(slash(srcApi), '<SRC>'),
    gitUrl: e.gitUrl.replace(slash(srcCli), '<SRC>').replace(slash(srcApi), '<SRC>'),
    ref: e.ref,
    subdir: e.subdir ?? null,
    path: e.path.replace(tag, '-TAG'),
    commit: e.commit === undefined ? 'none' : 'sha',
    hasGitSource: manifest.hasGitSource(e),
  })
  assert.deepEqual(shape(cliEntry, '-cli'), shape(apiEntry, '-api'))

  // The default branch was resolved (not assumed) on both faces.
  assert.equal(apiEntry.ref, 'main')
  assert.equal(cliEntry.ref, 'main')

  // `path` is repo-based, not name-based — a name override must not rename the
  // clone directory, or CLI and panel installs of the same repo drift apart.
  assert.doesNotMatch(cliEntry.path, /named-cli/)
  assert.doesNotMatch(apiEntry.path, /named-api/)
  assert.match(cliEntry.path, /src-add-cli/)
  assert.match(apiEntry.path, /src-add-api/)

  // Same derived link set, renamed the same way as the `update` cases above.
  const cliNames = await linkNames('named-cli')
  const apiNames = await linkNames('named-api')
  assert.deepEqual(cliNames, ['alpha-add-cli', 'beta-add-cli'])
  assert.deepEqual(apiNames, ['alpha-add-api', 'beta-add-api'])
  assert.deepEqual(normalize(cliNames, '-cli'), normalize(apiNames, '-api'))

  // Both clones are real clones carrying their own git state — not one-sided
  // snapshots — and each manifest recorded the commit it actually installed.
  // (The two fixtures are separate repositories, so their SHAs differ by
  // construction; what parity requires is that both faces record one at all.)
  const cliSha = await gitMod.getHeadCommit(paths.skillDir('src-add-cli'))
  const apiSha = await gitMod.getHeadCommit(paths.skillDir('src-add-api'))
  assert.match(cliSha, /^[0-9a-f]{40}$/)
  assert.match(apiSha, /^[0-9a-f]{40}$/)
  assert.equal(cliEntry.commit, cliSha)
  assert.equal(apiEntry.commit, apiSha)
  await stat(join(paths.skillDir('src-add-cli'), '.git'))
  await stat(join(paths.skillDir('src-add-api'), '.git'))
})

/* ------------------------------------------------------------------ */
/* add — the five §10.4 codes the route rebuilds from the core         */
/* ------------------------------------------------------------------ */

/** A repo whose root holds exactly one skill directory `alpha`. */
async function makeOneSkillRepo(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, 'alpha'), { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'alpha', 'SKILL.md'), `---\nname: ${name}\ndescription: a\n---\nv1\n`, 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'skill'])
}

test('add: --subdir pointing nowhere answers the former 400 subdir-not-found', async () => {
  const src = join(home, 'src-code-subdir')
  await makeOneSkillRepo(src, 'code-subdir')
  const settled = await addViaRoute({
    url: fileUrl(src),
    ref: 'main',
    subdir: 'skills/nowhere',
  })
  assert.equal(settled.status, 'error')
  assert.equal(settled.error, 'subdir-not-found')
})

test('add: a repo with neither SKILL.md nor a plugin marker answers 400 no-skill-md', async () => {
  const src = join(home, 'src-code-unknown')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'notes.txt'), 'nothing to see\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'empty'])

  const settled = await addViaRoute({ url: fileUrl(src), ref: 'main' })
  assert.equal(settled.status, 'error')
  assert.equal(settled.error, 'no-skill-md')
})

test('add: a root that yields zero installable skills answers 400 no-installable-skills', async () => {
  const src = join(home, 'src-code-noskills')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  // A root-level markdown file is *discovered* (so the repo is a plain skill
  // repo, neither unknown nor a plugin), while the full skill rules reject it:
  // no frontmatter name and no description, so it is a doc rather than a skill.
  await writeFile(join(src, 'notes.md'), 'not a skill\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'docs only'])

  const settled = await addViaRoute({ url: fileUrl(src), ref: 'main' })
  assert.equal(settled.status, 'error')
  assert.equal(settled.error, 'no-installable-skills')
})

test('add: a pure DSH plugin repo answers 400 dsh-plugin-repo', async () => {
  const src = join(home, 'src-code-plugin')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'cordis.patch.yml'), 'plugins: {}\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'plugin only'])

  const settled = await addViaRoute({ url: fileUrl(src), ref: 'main' })
  assert.equal(settled.status, 'error')
  assert.equal(settled.error, 'dsh-plugin-repo')
})

test('add: a wrapped skill with no confirm reaches the panel as a needs-confirm error', async () => {
  const src = join(home, 'src-code-wrapped')
  await makeOneSkillRepo(src, 'code-wrapped')
  // SKILL.md next to a plugin marker → wrapped-skill, which asks before taking
  // over. The panel's OpsIO can never answer "no" (it raises NeedsConfirm), so
  // the wrapped-skill branch surfaces the question rather than the `aborted`
  // code the CLI's non-TTY default produces.
  await writeFile(join(src, 'cordis.patch.yml'), 'plugins: {}\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'wrapper'])

  const settled = await addViaRoute({ url: fileUrl(src), ref: 'main' })
  assert.equal(settled.status, 'error')
  assert.match(String(settled.error), /^confirmation required: /)
  assert.match(String(settled.error), /DSH plugin wrapper/)

  // Nothing was registered and no partial clone was left behind.
  const after = await manifest.readManifest()
  assert.equal(manifest.findEntry(after, 'src-code-wrapped'), undefined)
  await assert.rejects(stat(paths.skillDir('src-code-wrapped')), { code: 'ENOENT' })
})

/* ------------------------------------------------------------------ */
/* adopt — the same core on both faces (§10.1/§10.3)                   */
/* ------------------------------------------------------------------ */

/** A snapshot entry: registered, a directory under repos/, no git source. */
async function seedSnapshot(name: string, skillName: string): Promise<void> {
  const dir = paths.repoDir(name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: snapshot\n---\nv1\n`,
    'utf8',
  )
  await manifest.addEntry({
    name,
    url: `package:${name}.zip`,
    gitUrl: '',
    ref: '',
    path: name,
    addedAt: new Date().toISOString(),
  })
}

test('adopt: CLI and the HTTP route turn a snapshot into the same git entry', async () => {
  const srcCli = join(home, 'src-adopt-cli')
  const srcApi = join(home, 'src-adopt-api')
  await makeOneSkillRepo(srcCli, 'adopt-cli')
  await makeOneSkillRepo(srcApi, 'adopt-api')
  await seedSnapshot('snap-cli', 'adopt-cli')
  await seedSnapshot('snap-api', 'adopt-api')

  // CLI face …
  assert.equal(await adoptCmd.adopt(['snap-cli', '--url', fileUrl(srcCli)]), 0)
  // … plugin face (202 + job channel).
  const accepted = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'snap-api', url: fileUrl(srcApi), confirm: true }),
  })
  assert.equal(accepted.status, 202)
  const { jobId } = dataOf<{ jobId: string }>(accepted)
  const settled = await waitForJob(jobId)
  assert.equal(settled.status, 'done', settled.error ?? '')

  const cliEntry = manifest.findEntry(await manifest.readManifest(), 'snap-cli')!
  const apiEntry = manifest.findEntry(await manifest.readManifest(), 'snap-api')!
  // Both entries became updatable git entries.
  assert.equal(manifest.hasGitSource(cliEntry), true)
  assert.equal(manifest.hasGitSource(apiEntry), true)
  assert.equal(cliEntry.ref, 'main')
  assert.equal(apiEntry.ref, 'main')
  assert.match(cliEntry.commit!, /^[0-9a-f]{40}$/)
  assert.match(apiEntry.commit!, /^[0-9a-f]{40}$/)
  // The entry keeps its name and path (§6) — only the source changed.
  assert.equal(cliEntry.name, 'snap-cli')
  assert.equal(apiEntry.name, 'snap-api')
  assert.equal(cliEntry.path, 'snap-cli')
  assert.equal(apiEntry.path, 'snap-api')
  // Neither snapshot had a link, and §6 forbids adopt from silently enabling an
  // entry: both faces leave the link set empty (a later `toggle` is the way to
  // expose it)…
  assert.deepEqual(await linkNames('snap-cli'), [])
  assert.deepEqual(await linkNames('snap-api'), [])
  assert.equal(await link.isLinked('snap-cli'), false)
  assert.equal(await link.isLinked('snap-api'), false)
  // …and both left a real clone (with git state) where the snapshot used to be.
  await stat(join(paths.repoDir('snap-cli'), '.git'))
  await stat(join(paths.repoDir('snap-api'), '.git'))
  // §9's invariant: the old directory is kept beside the new one, on both faces.
  const keptCli = (await readdir(paths.REPOS_DIR)).filter((n) => n.startsWith('snap-cli.pre-adopt-'))
  const keptApi = (await readdir(paths.REPOS_DIR)).filter((n) => n.startsWith('snap-api.pre-adopt-'))
  assert.equal(keptCli.length, 1, 'the CLI kept the previous directory as a backup')
  assert.equal(keptApi.length, 1, 'the route kept the previous directory as a backup')
})

test('adopt: an entry that was linked comes back linked on the route too', async () => {
  const src = join(home, 'src-adopt-linked')
  await makeOneSkillRepo(src, 'adopt-linked')
  await seedSnapshot('snap-linked', 'adopt-linked')
  await link.linkSkill('snap-linked', paths.repoDir('snap-linked'))

  const accepted = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'snap-linked', url: fileUrl(src), confirm: true }),
  })
  assert.equal(accepted.status, 202)
  const settled = await waitForJob(dataOf<{ jobId: string }>(accepted).jobId)
  assert.equal(settled.status, 'done', settled.error ?? '')

  // The route rebuilt the link set from the new source, under the entry name.
  assert.deepEqual(await linkNames('snap-linked'), ['snap-linked'])
  assert.equal(await link.isLinked('snap-linked'), true)
})

test('adopt: a missing entry is a 404 on the wire, not a job error', async () => {
  // §10.4 wants the code, and an adopt is a job — so the core's read-only guard
  // has to run before the 202. This is the route half of that contract.
  const res = await call('/skills-nexus/adopt', {
    method: 'POST',
    body: JSON.stringify({ name: 'nope-adopt-parity', url: 'github:owner/x', confirm: true }),
  })
  assert.equal(res.status, 404)
  const env = JSON.parse(res.raw) as { error?: string }
  assert.equal(env.error, 'not-found')
})

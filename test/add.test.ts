import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Integration tests for the `add` command against a local `file://` repo.
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
let add: typeof import('../src/cli/commands/add.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-add-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  add = await import('../src/cli/commands/add.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

test('add registers a repo and records the resolved commit', async () => {
  const src = join(home, 'src-a')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'SKILL.md'), '# test\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'initial'])

  assert.equal(await add.add([`${fileUrl(src)}#main`]), 0)
  const m = await manifest.readManifest()
  assert.equal(m.skills.length, 1)
  assert.match(m.skills[0]!.commit!, /^[0-9a-f]{40}$/)
})

test('re-adding a registered repo refuses without touching the existing clone', async () => {
  const src = join(home, 'src-b')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'SKILL.md'), '# test\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'initial'])
  const url = `${fileUrl(src)}#main`

  assert.equal(await add.add([url]), 0)
  const m1 = await manifest.readManifest()
  const dest = paths.skillDir(m1.skills[0]!.path)
  await stat(dest) // clone exists

  // Re-adding the same repo must refuse and leave everything intact.
  assert.equal(await add.add([url]), 1)
  const m2 = await manifest.readManifest()
  assert.equal(m2.skills.filter((s) => s.name === 'src-b').length, 1)
  await stat(dest) // clone still exists
})

/* ------------------------------------------------------------------ */
/* Collection repos (`skills/<name>/SKILL.md` layout + root docs)      */
/* ------------------------------------------------------------------ */

/** Create a nested collection repo: `skills/<name>/SKILL.md` + root docs. */
async function makeCollectionRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await mkdir(join(dir, 'skills', 'alpha'), { recursive: true })
  await mkdir(join(dir, 'skills', 'beta'), { recursive: true })
  await writeFile(
    join(dir, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha-skill\n---\nA',
    'utf8',
  )
  await writeFile(
    join(dir, 'skills', 'beta', 'SKILL.md'),
    '---\nname: beta-skill\n---\nB',
    'utf8',
  )
  // Root docs that must NOT qualify as skills.
  await writeFile(join(dir, 'README.zh-CN.md'), '# readme', 'utf8')
  await writeFile(join(dir, 'CONTRIBUTING.md'), '# contributing', 'utf8')
  await writeFile(join(dir, 'community-leaderboard.md'), '# board', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'collection'])
}

test('--subdir installs a single subdirectory of a collection repo', async () => {
  const src = join(home, 'src-c')
  await makeCollectionRepo(src)
  const url = `${fileUrl(src)}#main`

  assert.equal(await add.add([url, '--subdir', 'skills/alpha']), 0)
  const m = await manifest.readManifest()
  const e = m.skills.find((s) => s.name === 'alpha')
  assert.ok(e)
  assert.equal(e.subdir, 'skills/alpha')
  assert.equal(e.name, 'alpha') // default name = last subdir segment
  assert.equal(e.path, 'src-c-alpha') // path uniquified per subdir
})

test('--subdir pointing at a missing path fails and cleans up', async () => {
  const src = join(home, 'src-d')
  await makeCollectionRepo(src)
  const url = `${fileUrl(src)}#main`

  assert.equal(await add.add([url, '--subdir', 'skills/nope']), 1)
  const m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-d')).length, 0)
  await assert.rejects(stat(paths.skillDir('src-d-nope')))
})

test('installing a nested collection without --subdir is rejected', async () => {
  const src = join(home, 'src-e')
  await makeCollectionRepo(src)
  const url = `${fileUrl(src)}#main`

  // Root docs are located (so classification says plain-skill), but the full
  // skill rules yield zero skills → reject instead of "fake-installing".
  assert.equal(await add.add([url]), 1)
  const m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-e')).length, 0)
})

test('invalid --subdir values are rejected before cloning', async () => {
  const src = join(home, 'src-f')
  await makeCollectionRepo(src)
  const url = `${fileUrl(src)}#main`

  assert.equal(await add.add([url, '--subdir', '../escape']), 1)
  assert.equal(await add.add([url, '--subdir', '/abs/path']), 1)
  const m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-f')).length, 0)
})

test('large collections require confirmation unless --yes is given', async () => {
  const src = join(home, 'src-g')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  for (let i = 1; i <= 21; i++) {
    const n = String(i).padStart(2, '0')
    await writeFile(join(src, `skill-${n}.md`), `---\nname: skill-${n}\n---\nS`, 'utf8')
  }
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'large'])
  const url = `${fileUrl(src)}#main`

  // Non-TTY confirm defaults to "no" → aborted, nothing registered.
  assert.equal(await add.add([url]), 0)
  let m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-g')).length, 0)

  // --yes skips the guard and installs the whole collection.
  assert.equal(await add.add([url, '--yes']), 0)
  m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-g')).length, 1)
})

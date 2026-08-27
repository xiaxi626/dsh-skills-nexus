import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cloneRepo, getHeadCommit, isDetachedHead, parseGitSpec } from '../src/git.js'

/**
 * Integration tests for the `update` command against local `file://` remotes
 * (no network).
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the manifest→paths chain (same pattern as
 * test/manifest.test.ts).
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

/** Create a source repo with one commit on `main`. */
async function makeRepo(dir: string): Promise<void> {
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'SKILL.md'), '# test skill\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'initial'])
}

/** Add a second commit to a source repo. */
async function commitMore(dir: string): Promise<void> {
  await writeFile(join(dir, 'SKILL.md'), '# test skill v2\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'second'])
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

let home: string
let update: typeof import('../src/cli/commands/update.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-update-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  update = await import('../src/cli/commands/update.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

test('update fast-forwards a branch-pinned skill and re-stamps the commit', async () => {
  const src = join(home, 'src-branch')
  await mkdir(src, { recursive: true })
  await makeRepo(src)
  const before = await getHeadCommit(src)

  const dest = paths.skillDir('branch-skill')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest)
  assert.equal(await getHeadCommit(dest), before)

  await manifest.addEntry({
    name: 'branch-skill',
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'main',
    commit: before,
    path: 'branch-skill',
    addedAt: new Date().toISOString(),
  })

  // Upstream moves forward — a branch pin must follow.
  await commitMore(src)
  const upstream = await getHeadCommit(src)
  assert.notEqual(upstream, before)

  assert.equal(await update.update(['branch-skill']), 0)
  assert.equal(await getHeadCommit(dest), upstream)
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'branch-skill')!.commit, upstream)
})

test('update treats a tag-pinned skill as a fixed point', async () => {
  const src = join(home, 'src-tag')
  await mkdir(src, { recursive: true })
  await makeRepo(src)
  await git(src, ['tag', 'v1.0.0'])
  const tagSha = await getHeadCommit(src)

  const dest = paths.skillDir('tag-skill')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), dest)
  assert.equal(await isDetachedHead(dest), true)

  // Upstream moves forward after the tag — must NOT affect the pinned clone.
  await commitMore(src)
  assert.notEqual(await getHeadCommit(src), tagSha)

  await manifest.addEntry({
    name: 'tag-skill',
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'v1.0.0',
    commit: tagSha,
    path: 'tag-skill',
    addedAt: new Date().toISOString(),
  })

  assert.equal(await update.update(['tag-skill']), 0)
  assert.equal(await getHeadCommit(dest), tagSha)
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'tag-skill')!.commit, tagSha)
})

test('update restores a tag-pinned skill whose checkout drifted', async () => {
  const src = join(home, 'src-drift')
  await mkdir(src, { recursive: true })
  await makeRepo(src)
  await git(src, ['tag', 'v1.0.0'])
  const tagSha = await getHeadCommit(src)
  await commitMore(src)
  const newer = await getHeadCommit(src)

  const dest = paths.skillDir('drift-skill')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), dest)
  assert.equal(await getHeadCommit(dest), tagSha)

  // Drift: fetch the newer commit and check it out (simulates a manual
  // checkout or a moved working tree).
  await git(dest, ['fetch', '--depth', '1', 'origin', 'main'])
  await git(dest, ['checkout', 'FETCH_HEAD'])
  assert.equal(await getHeadCommit(dest), newer)

  await manifest.addEntry({
    name: 'drift-skill',
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'v1.0.0',
    commit: tagSha,
    path: 'drift-skill',
    addedAt: new Date().toISOString(),
  })

  assert.equal(await update.update(['drift-skill']), 0)
  assert.equal(await getHeadCommit(dest), tagSha)
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'drift-skill')!.commit, tagSha)
})

test('update fast-forwards a branch pin even when the clone is dirty', async () => {
  const src = join(home, 'src-dirty-branch')
  await mkdir(src, { recursive: true })
  await makeRepo(src)
  const before = await getHeadCommit(src)

  const dest = paths.skillDir('dirty-branch')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest)

  await manifest.addEntry({
    name: 'dirty-branch',
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'main',
    commit: before,
    path: 'dirty-branch',
    addedAt: new Date().toISOString(),
  })

  // Normalization-like edit: dirties the same tracked file upstream touches,
  // which used to make `git pull --ff-only` refuse to merge.
  await writeFile(join(dest, 'SKILL.md'), '# test skill\ndescription: normalized\n', 'utf8')

  await commitMore(src)
  const upstream = await getHeadCommit(src)
  assert.notEqual(upstream, before)

  assert.equal(await update.update(['dirty-branch']), 0)
  assert.equal(await getHeadCommit(dest), upstream)
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'dirty-branch')!.commit, upstream)
})

test('update restores a drifted tag pin even when the clone is dirty', async () => {
  const src = join(home, 'src-dirty-drift')
  await mkdir(src, { recursive: true })
  await makeRepo(src)
  await git(src, ['tag', 'v1.0.0'])
  const tagSha = await getHeadCommit(src)
  await commitMore(src)
  const newer = await getHeadCommit(src)

  const dest = paths.skillDir('dirty-drift')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), dest)

  // Drift away from the pin, then dirty the worktree (normalization edit).
  await git(dest, ['fetch', '--depth', '1', 'origin', 'main'])
  await git(dest, ['checkout', 'FETCH_HEAD'])
  assert.equal(await getHeadCommit(dest), newer)
  await writeFile(join(dest, 'SKILL.md'), '# test skill v2\ndescription: normalized\n', 'utf8')

  await manifest.addEntry({
    name: 'dirty-drift',
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'v1.0.0',
    commit: tagSha,
    path: 'dirty-drift',
    addedAt: new Date().toISOString(),
  })

  // The dirty tree must not block restoration to the pinned commit.
  assert.equal(await update.update(['dirty-drift']), 0)
  assert.equal(await getHeadCommit(dest), tagSha)
  // Restored content is back to the committed v1 file (re-normalization is
  // a no-op here: the test repo has no frontmatter to fix).
  // (normalize line endings — git checks out with CRLF on some platforms)
  assert.equal((await readFile(join(dest, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n'), '# test skill\n')
})

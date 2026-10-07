import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { cloneRepo, getCurrentBranch, getHeadCommit } from '../src/git.js'
import type { OpsIO } from '../src/ops-io.js'
import type { SkillEntry } from '../src/types.js'

const execFileAsync = promisify(execFile)
let home: string
let paths: typeof import('../src/paths.js')
let manifest: typeof import('../src/manifest.js')
let links: typeof import('../src/link.js')
let core: typeof import('../src/diff.js')
let cli: typeof import('../src/cli/commands/diff.js')
let locks: typeof import('../src/locks.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-diff-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  paths = await import('../src/paths.js')
  manifest = await import('../src/manifest.js')
  links = await import('../src/link.js')
  core = await import('../src/diff.js')
  cli = await import('../src/cli/commands/diff.js')
  locks = await import('../src/locks.js')
  assert.ok(paths.REPOS_DIR.startsWith(home))
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

async function git(cwd: string, args: string[], noLazyFetch = false): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...(noLazyFetch ? { GIT_NO_LAZY_FETCH: '1' } : {}),
    },
  })
  return stdout.trim()
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'uploadpack.allowFilter', 'true'])
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  await mkdir(join(dir, file, '..'), { recursive: true })
  await writeFile(join(dir, file), content, 'utf8')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', message])
  return getHeadCommit(dir)
}

function fileUrl(dir: string): string {
  return pathToFileURL(dir).href
}

async function install(
  name: string,
  src: string,
  options: { ref?: string; subdir?: string; locked?: boolean; link?: boolean } = {},
): Promise<{ dest: string; entry: SkillEntry }> {
  const ref = options.ref ?? 'main'
  const dest = paths.repoDir(name)
  await cloneRepo({ raw: fileUrl(src), url: fileUrl(src), ref }, dest, {
    ...(options.subdir === undefined ? {} : { subdir: options.subdir }),
  })
  const entry: SkillEntry = {
    name,
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref,
    commit: await getHeadCommit(dest),
    ...(options.subdir === undefined ? {} : { subdir: options.subdir }),
    ...(options.locked ? { locked: true } : {}),
    path: name,
    addedAt: '2026-01-01T00:00:00.000Z',
  }
  await manifest.addEntry(entry)
  if (options.link) await links.linkSkill(name, options.subdir ? join(dest, options.subdir) : dest)
  return { dest, entry }
}

interface CapturedIO extends OpsIO {
  out: string[]
  err: string[]
}

function output(): CapturedIO {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    emit: (line) => { out.push(line) },
    error: (line) => { err.push(line) },
    progress() {},
    confirm: async () => false,
    interactive: false,
  }
}

test('attached unlocked branch may omit ref and leaves HEAD, manifest, worktree and links unchanged', async () => {
  const src = join(home, 'src-default')
  await initRepo(src)
  const old = await commitFile(src, 'SKILL.md', '# old\n', 'old')
  const { dest, entry } = await install('default-diff', src, { link: true })
  const manifestBefore = await readFile(paths.MANIFEST_PATH, 'utf8')
  const linksBefore = await links.entryLinks(entry)
  const worktreeBefore = await readFile(join(dest, 'SKILL.md'), 'utf8')
  const next = await commitFile(src, 'SKILL.md', '# next\n', 'next')

  const io = output()
  assert.equal(await cli.diff(['default-diff'], io), 0)
  const patch = io.out.join('')
  assert.match(patch, /diff --git a\/SKILL\.md b\/SKILL\.md/)
  assert.match(patch, /-# old/)
  assert.match(patch, /\+# next/)
  assert.doesNotMatch(patch, /\u001b\[/)
  assert.deepEqual(io.err, [])

  assert.equal(await getHeadCommit(dest), old)
  assert.equal(await getCurrentBranch(dest), 'main')
  assert.equal(await readFile(paths.MANIFEST_PATH, 'utf8'), manifestBefore)
  assert.equal(await readFile(join(dest, 'SKILL.md'), 'utf8'), worktreeBefore)
  assert.deepEqual(await links.entryLinks(entry), linksBefore)
  assert.equal(await git(dest, ['rev-parse', 'FETCH_HEAD']), next)
  assert.equal(await git(dest, ['rev-parse', 'origin/main']), old, 'remote-tracking ref is not rewritten')
  assert.equal(await git(dest, ['rev-parse', '--is-shallow-repository']), 'true')
})

test('explicit branch, tag and SHA targets are fetched and compared without checkout', async () => {
  const src = join(home, 'src-refs')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', '# base\n', 'base')
  const { dest } = await install('ref-diff', src)
  await git(src, ['checkout', '-b', 'preview'])
  const target = await commitFile(src, 'SKILL.md', '# target\n', 'target')
  await git(src, ['tag', 'preview-tag'])

  for (const ref of ['preview', 'preview-tag', target]) {
    const result = await core.diffEntry('ref-diff', ref)
    assert.equal(result.toCommit, target, ref)
    assert.match(result.output, /\+# target/, ref)
    assert.equal(await getCurrentBranch(dest), 'main', ref)
  }
  await assert.rejects(git(dest, ['show-ref', '--verify', 'refs/remotes/origin/preview']))
  await assert.rejects(git(dest, ['show-ref', '--verify', 'refs/tags/preview-tag']))
})

test('detached and explicitly locked entries require a target', async () => {
  const src = join(home, 'src-required')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', '# one\n', 'one')
  await git(src, ['tag', 'v1'])
  await commitFile(src, 'SKILL.md', '# two\n', 'two')

  const detached = await install('detached-diff', src, { ref: 'v1' })
  await assert.rejects(core.diffEntry('detached-diff'), /detached HEAD; provide/)
  assert.match((await core.diffEntry('detached-diff', 'main')).output, /\+# two/)
  assert.equal(await getCurrentBranch(detached.dest), undefined)

  const locked = await install('locked-diff', src, { locked: true })
  await assert.rejects(core.diffEntry('locked-diff'), /explicitly locked; provide/)
  assert.equal((await core.diffEntry('locked-diff', 'main')).output, '')
  assert.equal(await getCurrentBranch(locked.dest), 'main')
})

test('subdir diff is path-limited, keeps blob:none, and lazily obtains target blobs', async () => {
  const src = join(home, 'src-sparse')
  await initRepo(src)
  await commitFile(src, 'skills/alpha/SKILL.md', '# alpha old\n', 'alpha old')
  await commitFile(src, 'outside.txt', 'outside old\n', 'outside old')
  const { dest } = await install('sparse-diff', src, { subdir: 'skills/alpha' })
  await writeFile(join(src, 'skills/alpha/SKILL.md'), '# alpha next\n', 'utf8')
  await writeFile(join(src, 'outside.txt'), 'outside next\n', 'utf8')
  await git(src, ['add', '-A'])
  await git(src, ['commit', '-m', 'both next'])
  const targetBlob = await git(src, ['rev-parse', 'HEAD:skills/alpha/SKILL.md'])

  assert.equal(await git(dest, ['config', '--get', 'remote.origin.partialclonefilter']), 'blob:none')
  await assert.rejects(git(dest, ['cat-file', '-e', targetBlob], true))
  const result = await core.diffEntry('sparse-diff')
  assert.match(result.output, /skills\/alpha\/SKILL\.md/)
  assert.match(result.output, /alpha next/)
  assert.doesNotMatch(result.output, /outside\.txt|outside next/)
  assert.equal(await git(dest, ['cat-file', '-e', targetBlob], true), '')
  assert.equal(await git(dest, ['rev-parse', '--is-shallow-repository']), 'true')
})

test('--stat emits statistics only', async () => {
  const src = join(home, 'src-stat')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', '# old\n', 'old')
  await install('stat-diff', src)
  await commitFile(src, 'SKILL.md', '# new\n', 'new')

  const io = output()
  assert.equal(await cli.diff(['stat-diff', '--stat'], io), 0)
  assert.match(io.out.join(''), /SKILL\.md\s+\|/)
  assert.match(io.out.join(''), /1 file changed/)
  assert.doesNotMatch(io.out.join(''), /diff --git|@@/)
})

test('argument parser is strict and unsafe fetch refs are rejected before Git fetch', async () => {
  assert.deepEqual(cli.parseDiffArgs(['demo']), { name: 'demo', stat: false })
  assert.deepEqual(cli.parseDiffArgs(['--stat', 'demo', 'v1']), { name: 'demo', ref: 'v1', stat: true })
  for (const argv of [[], ['a', 'b', 'c'], ['a', '--json'], ['a', '--stat=true']]) {
    assert.throws(() => cli.parseDiffArgs(argv))
  }

  const src = join(home, 'src-safe')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', '# safe\n', 'safe')
  const { dest } = await install('safe-diff', src)
  await assert.rejects(core.diffEntry('safe-diff', 'main:refs/heads/injected'), /Invalid diff ref/)
  await assert.rejects(git(dest, ['show-ref', '--verify', 'refs/heads/injected']))
})

test('source-less entries fail and a held per-entry lock blocks the command', async () => {
  await manifest.addEntry({
    name: 'snapshot-diff', url: 'package:x.zip', gitUrl: '', ref: '', path: 'snapshot-diff',
    addedAt: '2026-01-01T00:00:00.000Z',
  })
  await assert.rejects(core.diffEntry('snapshot-diff', 'main'), /no git source/)

  const src = join(home, 'src-lock')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', '# lock\n', 'lock')
  await install('busy-diff', src)
  const held = await locks.acquireSkillFileLock('busy-diff')
  const io = output()
  try {
    assert.equal(await cli.diff(['busy-diff'], io), 1)
  } finally {
    await held.release()
  }
  assert.match(io.err.join(''), /locked by another process/)
  assert.deepEqual(io.out, [])
})

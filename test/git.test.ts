import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  checkoutRef,
  cloneRepo,
  discardLocalChanges,
  FILTER_IGNORED_WARNING,
  getDefaultBranch,
  getHeadCommit,
  isDetachedHead,
  isDirtyWorktree,
  isRealDirectory,
  normalizeSubdir,
  parseGitSpec,
  repoSlug,
  resolveRefCommit,
  retry,
  sanitizeName,
} from '../src/git.js'
import { SPARSE_SKIP } from './sparse-capability.js'

/* ------------------------------------------------------------------ */
/* parseGitSpec — spec → cloneable URL + ref                           */
/* ------------------------------------------------------------------ */

test('github: shorthand resolves to a GitHub https URL', () => {
  const spec = parseGitSpec('github:owner/repo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
  assert.equal(spec.ref, 'main')
})

test('custom ref fallback is used when no #ref is present', () => {
  const spec = parseGitSpec('github:owner/repo', 'master')
  assert.equal(spec.ref, 'master')
})

test('#ref overrides the fallback', () => {
  const spec = parseGitSpec('github:owner/repo#dev', 'master')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
  assert.equal(spec.ref, 'dev')
})

test('empty #ref keeps the fallback', () => {
  const spec = parseGitSpec('github:owner/repo#')
  assert.equal(spec.ref, 'main')
})

test('#ref works on full URLs too', () => {
  const spec = parseGitSpec('https://github.com/owner/repo#v1.2.3')
  assert.equal(spec.ref, 'v1.2.3')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('owner/repo shorthand expands to GitHub', () => {
  const spec = parseGitSpec('owner/repo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('bare https URL gets a .git suffix', () => {
  const spec = parseGitSpec('https://github.com/owner/repo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('https URL already ending in .git is left alone', () => {
  const spec = parseGitSpec('https://github.com/owner/repo.git')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('/tree/<ref>/... subpath is reduced to the repo root', () => {
  const spec = parseGitSpec('https://github.com/owner/repo/tree/main/skills/foo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
  // The ref inside the tree path is *not* extracted; only #ref is.
  assert.equal(spec.ref, 'main')
})

test('git+https: scheme is stripped and normalized', () => {
  assert.equal(
    parseGitSpec('git+https://github.com/owner/repo').url,
    'https://github.com/owner/repo.git',
  )
  assert.equal(
    parseGitSpec('git+https://github.com/owner/repo.git').url,
    'https://github.com/owner/repo.git',
  )
})

test('scp-like git@ and ssh:// URLs pass through untouched', () => {
  assert.equal(
    parseGitSpec('git@github.com:owner/repo.git').url,
    'git@github.com:owner/repo.git',
  )
  assert.equal(
    parseGitSpec('ssh://git@github.com/owner/repo.git').url,
    'ssh://git@github.com/owner/repo.git',
  )
})

test('non-GitHub https host is still normalized with .git', () => {
  const spec = parseGitSpec('https://git.example.com/team/project')
  assert.equal(spec.url, 'https://git.example.com/team/project.git')
})

test('whitespace is trimmed before parsing', () => {
  const spec = parseGitSpec('  github:owner/repo  ')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('raw preserves the original input', () => {
  const input = 'github:owner/repo#dev'
  assert.equal(parseGitSpec(input).raw, input)
})

test('parseGitSpec rejects option-like, helper-syntax and control-character specs', () => {
  const bad = ['-u', '--upload-pack=evil', 'ext::sh -c id', 'git+ext::sh', 'foo::bar', 'https://x\ny']
  for (const value of bad) {
    assert.throws(
      () => parseGitSpec(value),
      /Invalid repo spec/,
      `expected ${JSON.stringify(value)} to be rejected`,
    )
  }
})

test('parseGitSpec rejects unsupported URL schemes but keeps file:// and local paths', () => {
  assert.throws(() => parseGitSpec('ftp://host/repo'), /Unsupported URL scheme "ftp"/)
  assert.throws(() => parseGitSpec('gopher://host/repo'), /Unsupported URL scheme "gopher"/)
  // The offline verify flows clone over file:// and bare local paths.
  assert.equal(parseGitSpec('file:///tmp/collection#main').url, 'file:///tmp/collection')
  assert.equal(parseGitSpec('/tmp/local-repo#main').url, '/tmp/local-repo')
})

test('parseGitSpec rejects refs that would be read as git options or helpers', () => {
  assert.throws(() => parseGitSpec('github:owner/repo#--upload-pack=evil'), /Invalid ref/)
  assert.throws(() => parseGitSpec('github:owner/repo#-x'), /Invalid ref/)
  assert.throws(() => parseGitSpec('github:owner/repo#a::b'), /Invalid ref/)
  assert.throws(() => parseGitSpec('github:owner/repo', '--evil'), /Invalid ref/)
})

/* ------------------------------------------------------------------ */
/* repoSlug — URL → directory-usable repo name                         */
/* ------------------------------------------------------------------ */

test('repoSlug takes the last URL segment', () => {
  assert.equal(repoSlug(parseGitSpec('github:owner/repo')), 'repo')
  assert.equal(repoSlug(parseGitSpec('https://github.com/owner/skill-repo.git')), 'skill-repo')
})

test('repoSlug handles trailing slashes', () => {
  assert.equal(repoSlug(parseGitSpec('https://github.com/owner/repo/')), 'repo')
})

test('repoSlug falls back to "skill" for an empty URL', () => {
  assert.equal(repoSlug({ raw: '', url: '', ref: 'main' }), 'skill')
})

/* ------------------------------------------------------------------ */
/* sanitizeName — arbitrary text → safe directory segment              */
/* ------------------------------------------------------------------ */

test('sanitizeName lowercases and replaces unsafe characters', () => {
  assert.equal(sanitizeName('My Skill Repo!'), 'my-skill-repo')
  assert.equal(sanitizeName('UPPER'), 'upper')
})

test('sanitizeName collapses separator runs', () => {
  assert.equal(sanitizeName('a!!b'), 'a-b')
})

test('sanitizeName replaces dots and underscores with dashes', () => {
  assert.equal(sanitizeName('a.b_c-d'), 'a-b-c-d')
})

test('sanitizeName trims leading/trailing dashes', () => {
  assert.equal(sanitizeName('-foo-'), 'foo')
})

test('sanitizeName falls back to "skill" when nothing remains', () => {
  assert.equal(sanitizeName('中文名'), 'skill')
  assert.equal(sanitizeName('---'), 'skill')
  assert.equal(sanitizeName(''), 'skill')
})

/* ------------------------------------------------------------------ */
/* Local-repo helpers (spawn git against a temp repo; no network)      */
/* ------------------------------------------------------------------ */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

/** Create a temp git repo with one commit on `main` inside `dir`. */
async function makeRepo(dir: string): Promise<void> {
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'SKILL.md'), '# test skill\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'initial'])
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

test('getHeadCommit returns the full commit SHA', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  try {
    await makeRepo(dir)
    assert.match(await getHeadCommit(dir), /^[0-9a-f]{40}$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('isDetachedHead is false on a branch and true after a commit checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  try {
    await makeRepo(dir)
    assert.equal(await isDetachedHead(dir), false)
    await checkoutRef(dir, await getHeadCommit(dir))
    assert.equal(await isDetachedHead(dir), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveRefCommit dereferences branches and tags to commit SHAs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  try {
    await makeRepo(dir)
    const head = await getHeadCommit(dir)
    assert.equal(await resolveRefCommit(dir, 'main'), head)
    await git(dir, ['tag', 'v1.0.0'])
    assert.equal(await resolveRefCommit(dir, 'v1.0.0'), head)
    assert.equal(await resolveRefCommit(dir, head), head)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('getDefaultBranch returns the declared branch, falling back to "main" for hostile names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  try {
    await mkdir(src, { recursive: true })
    await makeRepo(src)
    const sha = await getHeadCommit(src)
    await git(src, ['update-ref', 'refs/heads/stable', sha])
    await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/stable'])
    // A normal declared name passes through (≠ the fallback, so it is visible).
    assert.equal(await getDefaultBranch(fileUrl(src)), 'stable')
    // A refname may start with a dash (only the CLI *shorthand* rejects it),
    // so a remote can declare it as its default branch; it must never reach
    // git's argument list as a ref.
    await git(src, ['update-ref', 'refs/heads/-lead', sha])
    await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/-lead'])
    assert.equal(await getDefaultBranch(fileUrl(src)), 'main')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cloneRepo at a tag leaves a detached HEAD (pinned = fixed point)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeRepo(src)
    await git(src, ['tag', 'v1.0.0'])
    const sha = await getHeadCommit(src)
    await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), dest)
    assert.equal(await isDetachedHead(dest), true)
    assert.equal(await getHeadCommit(dest), sha)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cloneRepo at a branch keeps a symbolic HEAD (updatable)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeRepo(src)
    await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest)
    assert.equal(await isDetachedHead(dest), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('isDirtyWorktree detects changes; discardLocalChanges resets them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  try {
    await makeRepo(dir)
    assert.equal(await isDirtyWorktree(dir), false)

    // Normalization-like edit to a tracked file plus a stray untracked file.
    await writeFile(join(dir, 'SKILL.md'), '# test skill\ndescription: x\n', 'utf8')
    await writeFile(join(dir, 'stray.md'), 'untracked\n', 'utf8')
    assert.equal(await isDirtyWorktree(dir), true)

    await discardLocalChanges(dir)
    assert.equal(await isDirtyWorktree(dir), false)
    // Tracked file restored to its committed content; untracked file gone.
    // (normalize line endings — git checks out with CRLF on some platforms)
    assert.equal((await readFile(join(dir, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n'), '# test skill\n')
    await assert.rejects(readFile(join(dir, 'stray.md'), 'utf8'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cloneRepo at a raw commit SHA falls back to clone+fetch+checkout (detached HEAD)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeRepo(src)
    const sha = await getHeadCommit(src)
    // ref is a 40-hex commit SHA — `--branch <sha>` always fails, so cloneRepo
    // falls back to clone-default + fetch + checkout.
    await cloneRepo(parseGitSpec(`${fileUrl(src)}#${sha}`), dest)
    assert.equal(await isDetachedHead(dest), true)
    assert.equal(await getHeadCommit(dest), sha)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* retry — exponential-backoff helper (unit-tested with mock fns)      */
/* ------------------------------------------------------------------ */

test('retry returns result on first success', async () => {
  let calls = 0
  const result = await retry(async () => {
    calls++
    return 'ok'
  }, { retries: 2, minDelay: 1 })
  assert.equal(result, 'ok')
  assert.equal(calls, 1)
})

test('retry exhausts attempts then throws', async () => {
  let calls = 0
  await assert.rejects(
    retry(async () => {
      calls++
      throw new Error('network')
    }, { retries: 2, minDelay: 1 }),
    /network/,
  )
  assert.equal(calls, 3)
})

test('retry succeeds on second attempt', async () => {
  let calls = 0
  const result = await retry(async () => {
    calls++
    if (calls < 2) throw new Error('transient')
    return 'recovered'
  }, { retries: 2, minDelay: 1 })
  assert.equal(result, 'recovered')
  assert.equal(calls, 2)
})

/* ------------------------------------------------------------------ */
/* normalizeSubdir — --subdir value → repository-relative path         */
/* ------------------------------------------------------------------ */

test('normalizeSubdir keeps already-normalized paths untouched', () => {
  assert.equal(normalizeSubdir('skills/foo'), 'skills/foo')
  assert.equal(normalizeSubdir('skills/a b/c-d_e'), 'skills/a b/c-d_e')
})

test('normalizeSubdir unifies separators and drops empty / "." segments', () => {
  assert.equal(normalizeSubdir('skills\\foo'), 'skills/foo')
  assert.equal(normalizeSubdir('./skills//foo/'), 'skills/foo')
  assert.equal(normalizeSubdir('.'), '.')
  assert.equal(normalizeSubdir('./'), '.')
})

test('normalizeSubdir rejects absolute, drive, UNC and escaping paths', () => {
  const bad = ['', '/abs/path', '\\abs', 'C:/x', 'c:x', '..', 'a/../b', 'a\\..\\b', '..\\b']
  for (const value of bad) {
    assert.throws(
      () => normalizeSubdir(value),
      /Invalid --subdir/,
      `expected ${JSON.stringify(value)} to be rejected`,
    )
  }
})

test('normalizeSubdir rejects control characters', () => {
  assert.throws(() => normalizeSubdir('a\u0000b'), /Invalid --subdir/)
  assert.throws(() => normalizeSubdir('a\nb'), /Invalid --subdir/)
})

test('normalizeSubdir keeps glob characters and dots as literal names', () => {
  // These are directory names, never patterns — no glob interpretation.
  assert.equal(normalizeSubdir('skills/[draft]'), 'skills/[draft]')
  assert.equal(normalizeSubdir('skills/..foo'), 'skills/..foo')
  assert.equal(normalizeSubdir('skills/中文名'), 'skills/中文名')
})

/* ------------------------------------------------------------------ */
/* isRealDirectory — symlinks are not directories                      */
/* ------------------------------------------------------------------ */

test('isRealDirectory accepts real directories and rejects files, symlinks and missing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const real = join(root, 'real')
  const target = join(root, 'target')
  const link = join(root, 'link')
  const file = join(root, 'file.txt')
  try {
    await mkdir(real)
    await mkdir(target)
    await writeFile(file, 'x\n', 'utf8')
    // Junctions need no elevation on Windows; POSIX uses a plain dir symlink.
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal(await isRealDirectory(real), true)
    assert.equal(await isRealDirectory(link), false)
    assert.equal(await isRealDirectory(file), false)
    assert.equal(await isRealDirectory(join(root, 'missing')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* Sparse installs — partial clone + cone-mode sparse-checkout         */
/* ------------------------------------------------------------------ */

/**
 * Collection repo for the sparse tests: two sibling skills, a direct file
 * under the ancestor directory, a root doc, and an unrelated assets/ tree
 * (covering the cone-mode keep/exclude boundary).
 */
async function makeSparseRepo(dir: string): Promise<void> {
  await mkdir(join(dir, 'skills', 'alpha', 'references'), { recursive: true })
  await mkdir(join(dir, 'skills', 'beta'), { recursive: true })
  await mkdir(join(dir, 'assets'), { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'skills', 'alpha', 'SKILL.md'), '# alpha\n', 'utf8')
  await writeFile(join(dir, 'skills', 'alpha', 'references', 'ref.md'), 'ref\n', 'utf8')
  await writeFile(join(dir, 'skills', 'beta', 'SKILL.md'), '# beta\n', 'utf8')
  await writeFile(join(dir, 'skills', 'index.md'), '# index\n', 'utf8')
  await writeFile(join(dir, 'assets', 'large.bin'), 'x'.repeat(2048), 'utf8')
  await writeFile(join(dir, 'README.md'), '# root doc\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'collection'])
}

/** All object ids in a clone's local object database (no lazy fetches). */
async function objectIds(dir: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'],
    { cwd: dir },
  )
  return stdout
}

test('sparse clone materializes the target tree only (branch, filter honored)', { skip: SPARSE_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeSparseRepo(src)
    await git(src, ['config', 'uploadpack.allowFilter', 'true'])

    const res = await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest, { subdir: 'skills/alpha' })

    assert.equal(res.mode, 'sparse')
    assert.deepEqual(res.warnings, [])
    assert.equal(await isDetachedHead(dest), false)

    // The target's whole subtree is on disk…
    // (normalize line endings — git checks out with CRLF on some platforms)
    assert.equal((await readFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n'), '# alpha\n')
    await stat(join(dest, 'skills', 'alpha', 'references', 'ref.md'))
    // …as are the files cone keeps beside it (repo root + ancestor dirs)…
    await stat(join(dest, 'README.md'))
    await stat(join(dest, 'skills', 'index.md'))
    // …while unrelated trees are not materialized.
    await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
    await assert.rejects(stat(join(dest, 'assets')), { code: 'ENOENT' })

    // The blob filter really kept beta's content out of the object database.
    const betaBlob = (await execFileAsync('git', ['rev-parse', 'HEAD:skills/beta/SKILL.md'], { cwd: src })).stdout.trim()
    const alphaBlob = (await execFileAsync('git', ['rev-parse', 'HEAD:skills/alpha/SKILL.md'], { cwd: src })).stdout.trim()
    const objects = await objectIds(dest)
    assert.ok(!objects.includes(betaBlob), 'beta blob must not be in the sparse clone')
    assert.ok(objects.includes(alphaBlob), 'alpha blob must be present')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sparse clone warns when the remote ignores the blob filter', { skip: SPARSE_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeSparseRepo(src)
    // file:// remotes refuse filters unless uploadpack.allowFilter is set —
    // exactly the "remote ignored --filter" case.
    const res = await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest, { subdir: 'skills/alpha' })
    assert.equal(res.mode, 'sparse')
    assert.deepEqual(res.warnings, [FILTER_IGNORED_WARNING])
    // The worktree is still sparse even though the objects were not filtered.
    await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sparse clone at a tag stays detached and materializes only the subdir', { skip: SPARSE_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeSparseRepo(src)
    await git(src, ['tag', 'v1.0.0'])
    await git(src, ['config', 'uploadpack.allowFilter', 'true'])
    const sha = await getHeadCommit(src)

    const res = await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), dest, { subdir: 'skills/alpha' })
    assert.equal(res.mode, 'sparse')
    assert.equal(await isDetachedHead(dest), true)
    assert.equal(await getHeadCommit(dest), sha)
    await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sparse clone at a fixed old commit materializes a directory that no longer exists on main', { skip: SPARSE_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeSparseRepo(src)
    await mkdir(join(src, 'skills', 'legacy'))
    await writeFile(join(src, 'skills', 'legacy', 'SKILL.md'), '# legacy\n', 'utf8')
    await git(src, ['add', '.'])
    await git(src, ['commit', '-m', 'add legacy'])
    const withLegacy = await getHeadCommit(src)
    await git(src, ['rm', '-r', 'skills/legacy'])
    await git(src, ['commit', '-m', 'drop legacy'])
    await git(src, ['config', 'uploadpack.allowFilter', 'true'])
    await git(src, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])

    const res = await cloneRepo(parseGitSpec(`${fileUrl(src)}#${withLegacy}`), dest, { subdir: 'skills/legacy' })
    assert.equal(res.mode, 'sparse')
    assert.equal(await isDetachedHead(dest), true)
    assert.equal(await getHeadCommit(dest), withLegacy)
    assert.equal((await readFile(join(dest, 'skills', 'legacy', 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n'), '# legacy\n')
    await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sparse clone accepts a hex-looking branch name', { skip: SPARSE_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  try {
    await mkdir(src, { recursive: true })
    await makeSparseRepo(src)
    await git(src, ['branch', 'deadbeef'])
    await git(src, ['config', 'uploadpack.allowFilter', 'true'])
    const head = await getHeadCommit(src)

    const res = await cloneRepo(parseGitSpec(`${fileUrl(src)}#deadbeef`), dest, { subdir: 'skills/alpha' })
    assert.equal(res.mode, 'sparse')
    assert.equal(await isDetachedHead(dest), false)
    assert.equal(await getHeadCommit(dest), head)
    await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the sparse flow works when the process cwd is not a repository', { skip: SPARSE_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const src = join(root, 'src')
  const dest = join(root, 'clone')
  const outside = join(root, 'outside')
  const prev = process.cwd()
  try {
    await mkdir(src, { recursive: true })
    await mkdir(outside, { recursive: true })
    await makeSparseRepo(src)
    await git(src, ['config', 'uploadpack.allowFilter', 'true'])
    // The first capability probe runs in the *current* directory, which here
    // is not a Git repository — the probe must still work there.
    process.chdir(outside)
    const res = await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest, { subdir: 'skills/alpha' })
    assert.equal(res.mode, 'sparse')
  } finally {
    process.chdir(prev)
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed sparse clone reports the error and leaves no directory behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const dest = join(root, 'clone')
  try {
    await assert.rejects(
      cloneRepo(parseGitSpec(`${fileUrl(join(root, 'missing'))}#main`), dest, { subdir: 'skills/alpha' }),
      /fatal|does not appear|not found/i,
    )
    await assert.rejects(stat(dest), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sparse clone refuses to reuse an existing target path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-git-'))
  const dest = join(root, 'clone')
  try {
    await mkdir(dest)
    await assert.rejects(
      cloneRepo(parseGitSpec('file:///nonexistent/src#main'), dest, { subdir: 'skills/alpha' }),
      /Refusing to clone into an existing path/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

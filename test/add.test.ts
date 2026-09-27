import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, lstat, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  delete process.env.DSH_HOME
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

/* ------------------------------------------------------------------ */
/* Batch install (multiple repo specs in one `add` call)               */
/* ------------------------------------------------------------------ */

/** Create a source repo with a single root SKILL.md on `main`. */
async function makeSkillRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'SKILL.md'), '# test\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'initial'])
}

test('add installs multiple repos in a single call', async () => {
  const a = join(home, 'src-multi-a')
  const b = join(home, 'src-multi-b')
  await makeSkillRepo(a)
  await makeSkillRepo(b)

  const rc = await add.add([`${fileUrl(a)}#main`, `${fileUrl(b)}#main`])
  assert.equal(rc, 0)
  const m = await manifest.readManifest()
  assert.ok(m.skills.find((s) => s.name === 'src-multi-a'))
  assert.ok(m.skills.find((s) => s.name === 'src-multi-b'))
})

test('add refuses per-repo options combined with multiple specs (installs nothing)', async () => {
  const a = join(home, 'src-guard-a')
  const b = join(home, 'src-guard-b')
  await makeSkillRepo(a)
  await makeSkillRepo(b)

  // --name is one-to-one with a single repo; with two specs it is ambiguous,
  // so `add` must refuse up front rather than silently apply it to just one.
  const rc = await add.add([`${fileUrl(a)}#main`, `${fileUrl(b)}#main`, '--name', 'x'])
  assert.equal(rc, 1)
  const m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-guard')).length, 0)
})

test('add continues past a per-repo failure and reports it in the exit code', async () => {
  const a = join(home, 'src-part-a')
  const b = join(home, 'src-part-b')
  await makeSkillRepo(a)
  await makeSkillRepo(b)

  // Install A first, so the batch below hits a duplicate for A but still adds B.
  assert.equal(await add.add([`${fileUrl(a)}#main`]), 0)

  const rc = await add.add([`${fileUrl(a)}#main`, `${fileUrl(b)}#main`])
  assert.equal(rc, 1) // A is a duplicate → failed; B added → non-zero aggregate
  const m = await manifest.readManifest()
  assert.ok(m.skills.find((s) => s.name === 'src-part-b')) // B added despite A failing
  assert.equal(m.skills.filter((s) => s.name === 'src-part-a').length, 1) // A not duplicated
})

/* ------------------------------------------------------------------ */
/* Sparse install reporting, junction targets, and the C --name hint   */
/* ------------------------------------------------------------------ */

/** Capture everything `fn()` writes to stdout / stderr while it runs. */
async function captureOutput<T>(
  fn: () => Promise<T>,
): Promise<{ stdout: string; stderr: string; result: T }> {
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  let stdout = ''
  let stderr = ''
  process.stdout.write = ((chunk: string): boolean => {
    stdout += chunk
    return true
  }) as unknown as typeof process.stdout.write
  process.stderr.write = ((chunk: string): boolean => {
    stderr += chunk
    return true
  }) as unknown as typeof process.stderr.write
  try {
    const result = await fn()
    return { stdout, stderr, result }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

/** Number of times the redundant-`--name` hint is printed in stdout. */
function countHints(out: string): number {
  return (out.match(/提示：--name 与默认条目名/g) ?? []).length
}

/** Collection repo whose single skill lives at the literal path `subdir`. */
async function makeSubdirRepo(dir: string, subdir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  const abs = join(dir, ...subdir.split('/'))
  await mkdir(abs, { recursive: true })
  await writeFile(
    join(abs, 'SKILL.md'),
    '---\nname: x\ndescription: test skill\n---\nbody\n',
    'utf8',
  )
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'skill'])
}

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })
  return stdout.trim()
}

/* --- C: the hint fires exactly when --name repeats the default --- */

test('C: hint appears exactly once when --name repeats the default (space form)', async () => {
  const src = join(home, 'src-nh-1')
  await makeSubdirRepo(src, 'skills/daily-hot-news')
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/daily-hot-news', '--name', 'daily-hot-news']),
  )
  assert.equal(result, 0)
  assert.equal(countHints(stdout), 1)
  assert.match(stdout, /提示：--name 与默认条目名 "daily-hot-news" 相同，可省略。/)
})

test('C: no hint without an explicit --name', async () => {
  const src = join(home, 'src-nh-2')
  await makeSubdirRepo(src, 'skills/nh2-daily')
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/nh2-daily']),
  )
  assert.equal(result, 0)
  assert.equal(countHints(stdout), 0)
})

test('C: both sides are compared after sanitizing', async () => {
  // --name spelled differently but sanitizing to the same default…
  const a = join(home, 'src-nh-3')
  await makeSubdirRepo(a, 'skills/nh3-hot-news')
  const r1 = await captureOutput(() =>
    add.add([`${fileUrl(a)}#main`, '--subdir', 'skills/nh3-hot-news', '--name', 'Nh3_Hot.News']),
  )
  assert.equal(r1.result, 0)
  assert.equal(countHints(r1.stdout), 1)

  // …and a subdir leaf that itself needs sanitizing, matched cleanly.
  const b = join(home, 'src-nh-4')
  await makeSubdirRepo(b, 'skills/NH4_Hot.News')
  const r2 = await captureOutput(() =>
    add.add([`${fileUrl(b)}#main`, '--subdir', 'skills/NH4_Hot.News', '--name', 'nh4-hot-news']),
  )
  assert.equal(r2.result, 0)
  assert.equal(countHints(r2.stdout), 1)
})

test('C: separator merging and dash trimming both match', async () => {
  const a = join(home, 'src-nh-5')
  await makeSubdirRepo(a, 'skills/nh5-a!!b')
  const r1 = await captureOutput(() =>
    add.add([`${fileUrl(a)}#main`, '--subdir', 'skills/nh5-a!!b', '--name', 'nh5-a-b']),
  )
  assert.equal(r1.result, 0)
  assert.equal(countHints(r1.stdout), 1)

  const b = join(home, 'src-nh-6')
  await makeSubdirRepo(b, 'skills/nh6--foo-')
  const r2 = await captureOutput(() =>
    add.add([`${fileUrl(b)}#main`, '--subdir', 'skills/nh6--foo-', '--name', 'nh6-foo']),
  )
  assert.equal(r2.result, 0)
  assert.equal(countHints(r2.stdout), 1)
})

test('C: "skill" fallback matches on both sides (--name=--- form)', async () => {
  const src = join(home, 'src-nh-7')
  await makeSubdirRepo(src, 'skills/中文')
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/中文', '--name=---']),
  )
  assert.equal(result, 0)
  assert.equal(countHints(stdout), 1)
})

test('C: --name=value equals the space form', async () => {
  const src = join(home, 'src-nh-8')
  await makeSubdirRepo(src, 'skills/nh8-news')
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/nh8-news', '--name=nh8-news']),
  )
  assert.equal(result, 0)
  assert.equal(countHints(stdout), 1)
})

test('C: no hint when --name picks a different alias', async () => {
  const src = join(home, 'src-nh-9')
  await makeSubdirRepo(src, 'skills/nh9-news')
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/nh9-news', '--name=nh9-alias']),
  )
  assert.equal(result, 0)
  assert.equal(countHints(stdout), 0)
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'nh9-alias')?.subdir, 'skills/nh9-news')
})

test('C: no hint for a matching --name without --subdir', async () => {
  const src = join(home, 'src-nh-10')
  await makeSkillRepo(src)
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--name', 'src-nh-10']),
  )
  assert.equal(result, 0)
  assert.equal(countHints(stdout), 0)
})

test('C: no hint on failed installs', async () => {
  // (a) duplicate registration
  const dup = join(home, 'src-nh-11')
  await makeSubdirRepo(dup, 'skills/nh11-dup')
  const url = `${fileUrl(dup)}#main`
  assert.equal(await add.add([url, '--subdir', 'skills/nh11-dup', '--name', 'nh11-dup']), 0)
  const r1 = await captureOutput(() =>
    add.add([url, '--subdir', 'skills/nh11-dup', '--name', 'nh11-dup']),
  )
  assert.equal(r1.result, 1)
  assert.equal(countHints(r1.stdout), 0)

  // (b) target subdir does not exist
  const missing = join(home, 'src-nh-12')
  await makeSubdirRepo(missing, 'skills/nh12-present')
  const r2 = await captureOutput(() =>
    add.add([`${fileUrl(missing)}#main`, '--subdir', 'skills/nh12-missing', '--name', 'nh12-missing']),
  )
  assert.equal(r2.result, 1)
  assert.equal(countHints(r2.stdout), 0)

  // (c) invalid --subdir — rejected before any network-bound step
  const r3 = await captureOutput(() =>
    add.add([`${fileUrl(missing)}#main`, '--subdir', '../nh12x', '--name', 'nh12x']),
  )
  assert.equal(r3.result, 1)
  assert.equal(countHints(r3.stdout), 0)
  assert.match(r3.stderr, /Invalid --subdir/)
  assert.doesNotMatch(r3.stdout, /Cloning /)

  // (d) the subdir exists but yields zero installable skills
  const empty = join(home, 'src-nh-13')
  await mkdir(join(empty, 'skills', 'nh13-empty'), { recursive: true })
  await git(empty, ['init'])
  await git(empty, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(empty, ['config', 'user.email', 'test@example.com'])
  await git(empty, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(empty, 'skills', 'nh13-empty', 'notes.md'), 'not a skill\n', 'utf8')
  await git(empty, ['add', '.'])
  await git(empty, ['commit', '-m', 'docs only'])
  const r4 = await captureOutput(() =>
    add.add([`${fileUrl(empty)}#main`, '--subdir', 'skills/nh13-empty', '--name', 'nh13-empty']),
  )
  assert.equal(r4.result, 1)
  assert.equal(countHints(r4.stdout), 0)

  // (e) clone failure
  const r5 = await captureOutput(() =>
    add.add([`${fileUrl(join(home, 'nope-does-not-exist'))}#main`, '--subdir', 'skills/nh14-x', '--name', 'nh14-x']),
  )
  assert.equal(r5.result, 1)
  assert.equal(countHints(r5.stdout), 0)
})

test('C: no hint when a wrapped-skill install is aborted', async () => {
  const src = join(home, 'src-nh-15')
  await makeSubdirRepo(src, 'skills/nh15-alpha')
  // A plugin marker at the clone root next to a subdir SKILL.md → wrapped-skill.
  // The sparse clone keeps root files (cone), so classification still sees it…
  await writeFile(join(src, 'cordis.patch.yml'), 'plugins: {}\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'wrapper'])

  // …and the non-TTY confirm defaults to "no" → aborted, with no hint.
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/nh15-alpha', '--name', 'nh15-alpha']),
  )
  assert.equal(result, 0) // skipped, not failed
  assert.equal(countHints(stdout), 0)
  assert.match(stdout, /Aborted/)
  const m = await manifest.readManifest()
  assert.equal(m.skills.filter((s) => s.path.startsWith('src-nh-15')).length, 0)
})

/* --- Sparse reporting and junction targets --- */

test('--subdir reports the checkout mode and links the junction to the subdir', async () => {
  const src = join(home, 'src-jx')
  await makeSubdirRepo(src, 'skills/jx-alpha')
  const { stdout, result } = await captureOutput(() =>
    add.add([`${fileUrl(src)}#main`, '--subdir', 'skills/jx-alpha']),
  )
  assert.equal(result, 0)
  assert.match(stdout, /checkout: sparse/)
  assert.match(stdout, /only this subdir is materialized/)
  // file:// remotes ignore the blob filter — the warning must be visible.
  assert.match(stdout, /the remote ignored the blob filter/)

  const m = await manifest.readManifest()
  const e = m.skills.find((s) => s.name === 'jx-alpha')!
  const link = paths.skillLinkPath('jx-alpha')
  assert.ok((await lstat(link)).isSymbolicLink())
  const expected = join(paths.repoDir(e.path), 'skills', 'jx-alpha')
  assert.equal(resolve(await readlink(link)), resolve(expected))
  // The junction exposes the subdir's resources, not just the directory.
  assert.match(await readFile(join(link, 'SKILL.md'), 'utf8'), /name: x/)
})

test('a plain install prints no checkout-mode line', async () => {
  const src = join(home, 'src-plain')
  await makeSkillRepo(src)
  const { stdout, result } = await captureOutput(() => add.add([`${fileUrl(src)}#main`]))
  assert.equal(result, 0)
  assert.doesNotMatch(stdout, /checkout: /)
})

test('two subdirs of one repo install as independent clones', async () => {
  const src = join(home, 'src-pair')
  await mkdir(join(src, 'skills', 'pair-a'), { recursive: true })
  await mkdir(join(src, 'skills', 'pair-b'), { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'skills', 'pair-a', 'SKILL.md'), '---\nname: pair-a\ndescription: a\n---\nv1\n', 'utf8')
  await writeFile(join(src, 'skills', 'pair-b', 'SKILL.md'), '---\nname: pair-b\ndescription: b\n---\nv1\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'collection'])

  const url = `${fileUrl(src)}#main`
  assert.equal(await add.add([url, '--subdir', 'skills/pair-a']), 0)
  assert.equal(await add.add([url, '--subdir', 'skills/pair-b']), 0)

  const m = await manifest.readManifest()
  const a = m.skills.find((s) => s.name === 'pair-a')!
  const b = m.skills.find((s) => s.name === 'pair-b')!
  assert.equal(a.path, 'src-pair-pair-a')
  assert.equal(b.path, 'src-pair-pair-b')
  const destA = paths.repoDir(a.path)
  const destB = paths.repoDir(b.path)
  // Independent git state: each clone carries its own .git and HEAD…
  await stat(join(destA, '.git'))
  await stat(join(destB, '.git'))
  assert.equal(await headSha(destA), await headSha(destB))
  // …each junction points at its own subdir…
  assert.equal(resolve(await readlink(paths.skillLinkPath('pair-a'))), resolve(join(destA, 'skills', 'pair-a')))
  assert.equal(resolve(await readlink(paths.skillLinkPath('pair-b'))), resolve(join(destB, 'skills', 'pair-b')))
  // …and each clone materializes only its own subdir.
  await assert.rejects(stat(join(destA, 'skills', 'pair-b')), { code: 'ENOENT' })
  await assert.rejects(stat(join(destB, 'skills', 'pair-a')), { code: 'ENOENT' })
})

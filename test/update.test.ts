import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cloneRepo, getHeadCommit, isDetachedHead, parseGitSpec } from '../src/git.js'
import { SPARSE_SKIP } from './sparse-capability.js'

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
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-update-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  update = await import('../src/cli/commands/update.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  // `link` must arrive through the same dynamic chain: a *static* import of
  // src/link.ts would evaluate paths.ts while the module graph loads — before
  // DSH_HOME is repointed — so every symlink write lands in the real ~/.dsh
  // (observed once: the whole suite registered into the user's home).
  link = await import('../src/link.js')
  assert.ok(
    paths.OFFICIAL_SKILLS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.OFFICIAL_SKILLS_DIR}`,
  )
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

/* ------------------------------------------------------------------ */
/* Sparse clones — update keeps the sparse scope and restores pins     */
/* ------------------------------------------------------------------ */

/** Collection repo with skills/alpha + skills/beta on `main`. */
async function makeCollectionRepo(dir: string): Promise<void> {
  await mkdir(join(dir, 'skills', 'alpha'), { recursive: true })
  await mkdir(join(dir, 'skills', 'beta'), { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: a\n---\nv1\n', 'utf8')
  await writeFile(join(dir, 'skills', 'beta', 'SKILL.md'), '---\nname: beta-skill\ndescription: b\n---\nv1\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'collection'])
}

/** Register a sparse subdir clone in the manifest, mirroring `add`'s entry. */
async function addSparseEntry(name: string, src: string, ref: string, commit: string, subdir: string): Promise<void> {
  await manifest.addEntry({
    name,
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref,
    commit,
    subdir,
    path: name,
    addedAt: new Date().toISOString(),
  })
}

test('update fast-forwards a sparse branch clone and keeps the sparse scope', { skip: SPARSE_SKIP }, async () => {
  const src = join(home, 'src-sparse-branch')
  await mkdir(src, { recursive: true })
  await makeCollectionRepo(src)
  await git(src, ['config', 'uploadpack.allowFilter', 'true'])
  const before = await getHeadCommit(src)

  const dest = paths.skillDir('sparse-branch')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest, { subdir: 'skills/alpha' })
  await addSparseEntry('sparse-branch', src, 'main', before, 'skills/alpha')

  // Upstream edits the tracked skill.
  await writeFile(join(src, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: a\n---\nv2\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'second'])
  const upstream = await getHeadCommit(src)

  assert.equal(await update.update(['sparse-branch']), 0)
  assert.equal(await getHeadCommit(dest), upstream)
  assert.match(await readFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /v2/)
  // The sibling dir was never materialized and still is not.
  await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'sparse-branch')!.commit, upstream)
})

test('update restores a drifted sparse tag clone', { skip: SPARSE_SKIP }, async () => {
  const src = join(home, 'src-sparse-tag')
  await mkdir(src, { recursive: true })
  await makeCollectionRepo(src)
  await git(src, ['tag', 'v1.0.0'])
  await git(src, ['config', 'uploadpack.allowFilter', 'true'])
  const tagSha = await getHeadCommit(src)

  const dest = paths.skillDir('sparse-tag')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#v1.0.0`), dest, { subdir: 'skills/alpha' })
  assert.equal(await isDetachedHead(dest), true)
  await addSparseEntry('sparse-tag', src, 'v1.0.0', tagSha, 'skills/alpha')

  // Upstream moves forward; drift the clone to it (as a manual checkout would).
  await writeFile(join(src, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: a\n---\nv2\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'second'])
  const newer = await getHeadCommit(src)
  await git(dest, ['fetch', '--depth', '1', 'origin', 'main'])
  await git(dest, ['checkout', 'FETCH_HEAD'])
  assert.equal(await getHeadCommit(dest), newer)

  assert.equal(await update.update(['sparse-tag']), 0)
  assert.equal(await getHeadCommit(dest), tagSha)
  assert.match(await readFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /v1/)
  await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
})

test('update discards local edits in a sparse clone then fast-forwards', { skip: SPARSE_SKIP }, async () => {
  const src = join(home, 'src-sparse-dirty')
  await mkdir(src, { recursive: true })
  await makeCollectionRepo(src)
  await git(src, ['config', 'uploadpack.allowFilter', 'true'])
  const before = await getHeadCommit(src)

  const dest = paths.skillDir('sparse-dirty')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest, { subdir: 'skills/alpha' })
  await addSparseEntry('sparse-dirty', src, 'main', before, 'skills/alpha')

  // Normalization-like edit inside the materialized subdir.
  await writeFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'edited\n', 'utf8')

  await writeFile(join(src, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: a\n---\nv2\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'second'])
  const upstream = await getHeadCommit(src)

  assert.equal(await update.update(['sparse-dirty']), 0)
  assert.equal(await getHeadCommit(dest), upstream)
  assert.match(await readFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /v2/)
  await assert.rejects(stat(join(dest, 'skills', 'beta')), { code: 'ENOENT' })
})

test('updating one subdir clone leaves its sibling subdir clone untouched', { skip: SPARSE_SKIP }, async () => {
  const src = join(home, 'src-sparse-pair')
  await mkdir(src, { recursive: true })
  await makeCollectionRepo(src)
  await git(src, ['config', 'uploadpack.allowFilter', 'true'])
  const base = await getHeadCommit(src)

  const destA = paths.skillDir('pair-alpha')
  const destB = paths.skillDir('pair-beta')
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), destA, { subdir: 'skills/alpha' })
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), destB, { subdir: 'skills/beta' })
  await addSparseEntry('pair-alpha', src, 'main', base, 'skills/alpha')
  await addSparseEntry('pair-beta', src, 'main', base, 'skills/beta')

  // Upstream moves both dirs forward.
  await writeFile(join(src, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: a\n---\nv2\n', 'utf8')
  await writeFile(join(src, 'skills', 'beta', 'SKILL.md'), '---\nname: beta-skill\ndescription: b\n---\nv2\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'second'])
  const upstream = await getHeadCommit(src)

  assert.equal(await update.update(['pair-alpha']), 0)
  assert.equal(await getHeadCommit(destA), upstream)
  assert.match(await readFile(join(destA, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /v2/)

  // The sibling is untouched: same commit, same content, still sparse.
  assert.equal(await getHeadCommit(destB), base)
  assert.match(await readFile(join(destB, 'skills', 'beta', 'SKILL.md'), 'utf8'), /v1/)
  await assert.rejects(stat(join(destB, 'skills', 'alpha')), { code: 'ENOENT' })
  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'pair-beta')!.commit, base)
})

/* ------------------------------------------------------------------ */
/* Stale links: upstream rename / deletion must not leave residue      */
/* ------------------------------------------------------------------ */

/**
 * Single-level bundle: `<root>/alpha/SKILL.md` + `<root>/beta/SKILL.md`, each
 * naming its own skill.
 *
 * Unlike `makeCollectionRepo` (nested `skills/<name>/`, discoverable only via
 * `--subdir`), this layout is found by the root scan — so one entry yields two
 * skills, and `add` links each under its frontmatter name. Callers pass unique
 * skill names per test: every test in this file shares one fixture home, so a
 * name reused across tests would leak a link into the next test's assertions.
 */
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

/** Register a whole-repo clone plus the two links `add` would have created. */
async function addBundledEntry(
  name: string,
  src: string,
  commit: string,
  alphaName: string,
  betaName: string,
): Promise<string> {
  const dest = paths.skillDir(name)
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#main`), dest)
  await manifest.addEntry({
    name,
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref: 'main',
    commit,
    path: name,
    addedAt: new Date().toISOString(),
  })
  await link.linkSkill(alphaName, join(dest, 'alpha'))
  await link.linkSkill(betaName, join(dest, 'beta'))
  return dest
}

test('update drops the stale link of a skill renamed upstream', async () => {
  const src = join(home, 'src-bundled-rename')
  await mkdir(src, { recursive: true })
  await makeBundledRepo(src, 'alpha-ren', 'beta-ren')
  const base = await getHeadCommit(src)
  await addBundledEntry('bundled-rename', src, base, 'alpha-ren', 'beta-ren')

  // Both links exist as `add` created them.
  assert.equal(await link.isLinked('alpha-ren'), true)
  assert.equal(await link.isLinked('beta-ren'), true)

  // Upstream renames beta's frontmatter name.
  await writeFile(join(src, 'beta', 'SKILL.md'), '---\nname: beta-ren2\ndescription: b\n---\nv2\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'rename beta'])

  assert.equal(await update.update(['bundled-rename']), 0)

  // The new name is linked; the old one is gone instead of shadowing the same
  // SKILL.md under a second name.
  assert.equal(await link.isLinked('beta-ren2'), true)
  assert.equal(await link.isLinked('beta-ren'), false)
  assert.equal(await link.isLinked('alpha-ren'), true)
})

test('update removes the link of a skill deleted upstream instead of leaving it dangling', async () => {
  const src = join(home, 'src-bundled-drop')
  await mkdir(src, { recursive: true })
  await makeBundledRepo(src, 'alpha-drop', 'beta-drop')
  const base = await getHeadCommit(src)
  await addBundledEntry('bundled-drop', src, base, 'alpha-drop', 'beta-drop')

  // Upstream deletes the alpha skill outright.
  await rm(join(src, 'alpha'), { recursive: true, force: true })
  await git(src, ['add', '-A'])
  await git(src, ['commit', '-m', 'drop alpha'])

  assert.equal(await update.update(['bundled-drop']), 0)

  // The deleted skill's link is gone (before this change it survived, pointing
  // at a directory the pull had just removed). The survivor is relinked under
  // the single-skill rule — the entry name — since only one skill is left.
  assert.equal(await link.isLinked('alpha-drop'), false)
  assert.equal(await link.isLinked('bundled-drop'), true)

  const m = await manifest.readManifest()
  const entry = m.skills.find((s) => s.name === 'bundled-drop')!
  const names = (await link.entryLinks(entry)).map((l) => l.name).sort()
  assert.deepEqual(names, ['bundled-drop'])
})

test('update does not re-enable an entry whose links were removed', async () => {
  const src = join(home, 'src-bundled-disabled')
  await mkdir(src, { recursive: true })
  await makeBundledRepo(src, 'alpha-dis', 'beta-dis')
  const base = await getHeadCommit(src)
  const dest = await addBundledEntry('bundled-disabled', src, base, 'alpha-dis', 'beta-dis')

  // `disable` semantics: no link points into the clone any more.
  await link.unlinkSkill('alpha-dis')
  await link.unlinkSkill('beta-dis')

  await writeFile(join(src, 'beta', 'SKILL.md'), '---\nname: beta-dis2\ndescription: b\n---\nv2\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'rename beta'])

  assert.equal(await update.update(['bundled-disabled']), 0)
  // The pull happened …
  assert.match(await readFile(join(dest, 'beta', 'SKILL.md'), 'utf8'), /beta-dis2/)
  // … but a disabled entry stays disabled: no link is resurrected, under the
  // old name or the new one.
  assert.equal(await link.isLinked('alpha-dis'), false)
  assert.equal(await link.isLinked('beta-dis'), false)
  assert.equal(await link.isLinked('beta-dis2'), false)
})

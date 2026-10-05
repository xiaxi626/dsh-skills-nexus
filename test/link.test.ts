import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'

/**
 * Integration tests for the link layer (`src/link.ts`).
 *
 * These exercise the real filesystem primitives — `linkSkill` → `isEntryEnabled`
 * → `unlinkSkill` — rather than mocking them, because this is exactly the code
 * that behaves differently per platform. What the platform actually gives us:
 *
 *   - Windows: `symlink(target, path, 'junction')` creates an NTFS junction.
 *     It needs no elevation (a real directory symlink does), but Node reports
 *     it as a **plain directory**: `lstat().isSymbolicLink()` is false,
 *     `readlink()` fails with `EINVAL`, and `unlink()` fails with `EPERM`.
 *     `realpath()` resolves it correctly, and `rmdir()` removes it without
 *     touching the target — which is why `src/link.ts` reads through
 *     `resolveLinkTarget` and removes through `removeLinkEntry` instead of
 *     using the `lstat`/`readlink`/`unlink` triple.
 *   - macOS / Linux: the third `symlink` argument is ignored and a regular
 *     directory symlink is created; both readers work either way.
 *
 * The assertions below are therefore written against *resolution* (does the
 * link point where it should?) and not against link flavour, so one suite
 * covers both platforms. The one deliberate `lstat` use is for existence.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the link→paths chain (same pattern as test/add.test.ts).
 */

let home: string
let link: typeof import('../src/link.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-link-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  link = await import('../src/link.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** Materialize a real clone directory under <repos>/ and return its path. */
async function makeRepoDir(repoPath: string, subdir?: string): Promise<string> {
  const dir = subdir ? join(paths.repoDir(repoPath), subdir) : paths.repoDir(repoPath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n', 'utf8')
  return dir
}

function makeEntry(repoPath: string, name = repoPath): SkillEntry {
  return {
    name,
    url: `github:owner/${repoPath}#main`,
    gitUrl: `https://github.com/owner/${repoPath}.git`,
    ref: 'main',
    path: repoPath,
    addedAt: new Date().toISOString(),
  }
}

/**
 * Assert a link resolves to `expected`, comparing canonical paths.
 *
 * `readLinkTarget` returns the canonical path (`realpath`), which may differ
 * from the original path format (e.g. Windows 8.3 short names or macOS
 * synthetic symlinks).  Both sides are normalized through `realpath` so the
 * comparison is format-independent.
 */
async function assertLinkTarget(actual: string | undefined, expected: string): Promise<void> {
  assert.ok(actual, 'link target is defined')
  assert.equal(await realpath(actual), await realpath(expected))
}

test('linkSkill creates a link that isLinked and readLinkTarget see', async () => {
  const targetDir = await makeRepoDir('repo-a')

  assert.equal(await link.isLinked('skill-a'), false, 'absent before linking')
  await link.linkSkill('skill-a', targetDir)

  assert.equal(await link.isLinked('skill-a'), true, 'present after linking')

  const target = await link.readLinkTarget('skill-a')
  assert.ok(target, 'readLinkTarget resolves the link')
  // The assertion that matters, and the portable one: the link RESOLVES to the
  // directory it was created for. Do not assert `lstat().isSymbolicLink()` —
  // on Windows (Node 24) an NTFS junction reports `S_IFDIR` there, so that
  // check fails for a link that works perfectly, which is exactly how the
  // junction blind spot stayed hidden. `resolve` also normalizes the trailing
  // separator Node 20's `readlink` added on Windows.
  assert.equal(await realpath(target!), await realpath(targetDir), 'target is the linked directory')
  assert.equal(await link.readLinkTarget('not-a-skill'), undefined)
})

test('isEntryEnabled is true when a link points directly at the repo root (junction case)', async () => {
  const entry = makeEntry('repo-a')
  // repo-a was linked as `skill-a` in the previous test.
  assert.equal(await link.isEntryEnabled(entry), true)
})

test('isEntryEnabled is true when a link points into a repo subdir', async () => {
  const subdir = await makeRepoDir('repo-b', join('skills', 'foo'))
  await link.linkSkill('skill-b', subdir)

  const entry = makeEntry('repo-b')
  assert.equal(await link.isEntryEnabled(entry), true)
})

test('isEntryEnabled is false for an unrelated entry', async () => {
  const entry = makeEntry('repo-does-not-exist')
  assert.equal(await link.isEntryEnabled(entry), false)
})

test('linkSkill atomically repoints an existing link', async () => {
  const first = await makeRepoDir('repo-c1')
  const second = await makeRepoDir('repo-c2')

  await link.linkSkill('skill-c', first)
  await assertLinkTarget(await link.readLinkTarget('skill-c'), first)

  await link.linkSkill('skill-c', second)
  await assertLinkTarget(await link.readLinkTarget('skill-c'), second)
  assert.equal(await link.isEntryEnabled(makeEntry('repo-c2')), true)
  assert.equal(await link.isEntryEnabled(makeEntry('repo-c1')), false)
})

test('unlinkSkill removes the link and flips isEntryEnabled back to false', async () => {
  const targetDir = await makeRepoDir('repo-d')
  await link.linkSkill('skill-d', targetDir)
  const entry = makeEntry('repo-d')

  assert.equal(await link.isLinked('skill-d'), true)
  assert.equal(await link.isEntryEnabled(entry), true)

  await link.unlinkSkill('skill-d')
  assert.equal(await link.isLinked('skill-d'), false)
  assert.equal(await link.isEntryEnabled(entry), false)

  // Unlinking a non-existent link is a no-op, not an error.
  await link.unlinkSkill('skill-d')
})

test('hasCollision distinguishes real dirs from nexus-managed symlinks', async () => {
  // Absent → no collision.
  assert.equal(await link.hasCollision('skill-e'), false)

  // A real directory the user placed manually → collision.
  await mkdir(paths.skillLinkPath('skill-e'), { recursive: true })
  assert.equal(await link.hasCollision('skill-e'), true)

  // A symlink we manage → not a collision (safe to replace).
  const targetDir = await makeRepoDir('repo-f')
  await link.linkSkill('skill-f', targetDir)
  assert.equal(await link.hasCollision('skill-f'), false)
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute, resolve } from 'node:path'
import type { SkillEntry } from '../src/types.js'

/**
 * Integration tests for the symlink layer (`src/link.ts`).
 *
 * These exercise the real filesystem primitives — `linkSkill` → `isEntryEnabled`
 * → `unlinkSkill` — rather than mocking them, because this is exactly the code
 * that behaves differently per platform:
 *
 *   - Windows: `symlink(target, path, 'junction')` creates an NTFS junction.
 *     Junctions do not require elevated privileges (unlike real symlinks) and
 *     `readlink` returns the clean absolute target with no `\\?\` prefix. The
 *     `isEntryEnabled` exact-match branch (`resolved === base.slice(0, -1)`)
 *     is what makes a junction pointing straight at a repo root count as
 *     enabled.
 *   - macOS / Linux: the third `symlink` argument is ignored and a regular
 *     directory symlink is created.
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
 * Assert a link resolves to `expected`, comparing normalized paths.
 *
 * Do NOT compare `readLinkTarget` output with strict string equality: on
 * Windows + Node 20, `readlink` of a junction returns the target WITH a
 * trailing separator (`...\repo-c1\`), while Node 22+ strips it. `resolve`
 * normalizes the trailing separator away on every platform/Node version, so
 * the comparison stays stable. Production code is unaffected by this quirk —
 * `isEntryEnabled` already resolves targets via `path.resolve`.
 */
function assertLinkTarget(actual: string | undefined, expected: string): void {
  assert.ok(actual, 'link target is defined')
  assert.equal(resolve(actual), resolve(expected))
}

test('linkSkill creates a symlink/junction that isLinked and readLinkTarget see', async () => {
  const targetDir = await makeRepoDir('repo-a')

  assert.equal(await link.isLinked('skill-a'), false, 'absent before linking')
  await link.linkSkill('skill-a', targetDir)

  assert.equal(await link.isLinked('skill-a'), true, 'present after linking')
  const st = await lstat(paths.skillLinkPath('skill-a'))
  // Junctions on Windows report as symlinks via lstat, same as macOS/Linux.
  assert.equal(st.isSymbolicLink(), true, 'link is a symlink/junction, not a real dir')

  const target = await link.readLinkTarget('skill-a')
  assert.ok(target, 'readLinkTarget resolves the link')
  // Junction targets are absolute on Windows; symlinks are absolute here too
  // because linkSkill is always handed an absolute repo path.
  assert.equal(isAbsolute(target), true, 'target is an absolute path')
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
  assertLinkTarget(await link.readLinkTarget('skill-c'), first)

  await link.linkSkill('skill-c', second)
  assertLinkTarget(await link.readLinkTarget('skill-c'), second)
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

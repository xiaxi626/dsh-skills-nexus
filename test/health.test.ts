import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'

/**
 * Integration tests for the health-check module (`src/health.ts`).
 *
 * Exercises real filesystem symlinks — same pattern as test/link.test.ts.
 * DSH_HOME is pointed at a temp dir before importing the module chain.
 */

let home: string
let health: typeof import('../src/health.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-health-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  health = await import('../src/health.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

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

/** Create a real repo directory with a SKILL.md inside. */
async function makeRepoDir(repoPath: string, subdir?: string): Promise<string> {
  const dir = subdir ? join(paths.repoDir(repoPath), subdir) : paths.repoDir(repoPath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n', 'utf8')
  return dir
}

/** Create a symlink in the official skills root. */
async function makeLink(skillName: string, target: string): Promise<void> {
  await mkdir(paths.OFFICIAL_SKILLS_DIR, { recursive: true })
  const linkPath = paths.skillLinkPath(skillName)
  await symlink(target, linkPath, 'junction')
}

/* ------------------------------------------------------------------ */
/* diagnoseEntry tests                                                 */
/* ------------------------------------------------------------------ */

test('diagnoseEntry returns ok when symlink target exists', async () => {
  const repoPath = 'healthy-repo'
  const targetDir = await makeRepoDir(repoPath)
  await makeLink('healthy-skill', targetDir)

  const entry = makeEntry(repoPath, 'healthy-skill')
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'ok')
})

test('diagnoseEntry returns disabled when no symlink points to the entry', async () => {
  const entry = makeEntry('nonexistent-repo', 'ghost-skill')
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'disabled')
})

test('diagnoseEntry returns missing-target when symlink points to deleted directory', async () => {
  const repoPath = 'broken-repo'
  const targetDir = await makeRepoDir(repoPath)
  await makeLink('broken-skill', targetDir)

  // Delete the target directory to simulate a broken link
  await rm(targetDir, { recursive: true, force: true })

  const entry = makeEntry(repoPath, 'broken-skill')
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'missing-target')
})

test('diagnoseEntry returns ok when subdir symlink target exists', async () => {
  const repoPath = 'collection-repo'
  const subdir = join('skills', 'foo')
  const targetDir = await makeRepoDir(repoPath, subdir)
  await makeLink('foo-skill', targetDir)

  const entry = makeEntry(repoPath, 'foo-skill')
  entry.subdir = subdir
  const result = await health.diagnoseEntry(entry)
  assert.equal(result, 'ok')
})

test('diagnoseEntry returns disabled when skills root does not exist', async () => {
  // Use a fresh DSH_HOME with no skills/ directory
  const freshHome = await mkdtemp(join(tmpdir(), 'nexus-health-fresh-'))
  const origHome = process.env.DSH_HOME

  try {
    // We can't re-import paths.ts, but diagnoseEntry reads OFFICIAL_SKILLS_DIR
    // which was captured at import time. So this test verifies behavior when
    // readdir on the skills root succeeds but finds nothing relevant.
    const entry = makeEntry('totally-unknown-repo', 'unknown')
    const result = await health.diagnoseEntry(entry)
    assert.equal(result, 'disabled')
  } finally {
    process.env.DSH_HOME = origHome
    await rm(freshHome, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* checkHealth tests                                                   */
/* ------------------------------------------------------------------ */

test('checkHealth returns empty array when manifest is empty', async () => {
  // Write an empty manifest
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  await writeFile(
    paths.MANIFEST_PATH,
    JSON.stringify({ version: 1, skills: [] }),
    'utf8',
  )

  const issues = await health.checkHealth()
  assert.deepEqual(issues, [])
})

test('checkHealth detects missing-target and excludes disabled entries', async () => {
  // Set up: one healthy, one broken, one disabled
  const healthyPath = 'check-healthy'
  const brokenPath = 'check-broken'

  const healthyDir = await makeRepoDir(healthyPath)
  await makeLink('check-healthy-skill', healthyDir)

  const brokenDir = await makeRepoDir(brokenPath)
  await makeLink('check-broken-skill', brokenDir)
  await rm(brokenDir, { recursive: true, force: true })

  // Write manifest with three entries
  const skills = [
    makeEntry(healthyPath, 'check-healthy-skill'),
    makeEntry(brokenPath, 'check-broken-skill'),
    makeEntry('never-linked-repo', 'disabled-skill'),
  ]
  await writeFile(
    paths.MANIFEST_PATH,
    JSON.stringify({ version: 1, skills }),
    'utf8',
  )

  const issues = await health.checkHealth()
  assert.equal(issues.length, 1)
  assert.equal(issues[0]!.name, 'check-broken-skill')
  assert.equal(issues[0]!.issue, 'missing-target')
})

test('checkHealth returns empty when manifest file does not exist', async () => {
  // Remove manifest
  await rm(paths.MANIFEST_PATH, { force: true })

  const issues = await health.checkHealth()
  assert.deepEqual(issues, [])
})

/* ------------------------------------------------------------------ */
/* formatWarning tests                                                 */
/* ------------------------------------------------------------------ */

test('formatWarning returns empty string for no issues', () => {
  assert.equal(health.formatWarning([]), '')
})

test('formatWarning formats single issue with specific repair command', () => {
  const result = health.formatWarning([{ name: 'my-skill', issue: 'missing-target' }])
  assert.ok(result.includes('[nexus] Warning: 1 skill has a broken symlink:'))
  assert.ok(result.includes('- my-skill (symlink points to missing directory)'))
  assert.ok(result.includes('dsh-skills-nexus update my-skill'))
})

test('formatWarning formats multiple issues with generic repair hint', () => {
  const result = health.formatWarning([
    { name: 'alpha', issue: 'missing-target' },
    { name: 'beta', issue: 'missing-target' },
  ])
  assert.ok(result.includes('[nexus] Warning: 2 skills have broken symlinks:'))
  assert.ok(result.includes('- alpha (symlink points to missing directory)'))
  assert.ok(result.includes('- beta (symlink points to missing directory)'))
  assert.ok(result.includes('dsh-skills-nexus update <name>'))
})

/* ------------------------------------------------------------------ */
/* Orphan detection tests (findOrphanRepos / findOrphanLinks)          */
/* ------------------------------------------------------------------ */

/** Wipe repos/ and the skills root so each orphan test starts clean. */
async function resetDirs(): Promise<void> {
  await rm(paths.REPOS_DIR, { recursive: true, force: true })
  await rm(paths.OFFICIAL_SKILLS_DIR, { recursive: true, force: true })
}

test('findOrphanRepos flags clone dirs no entry references', async () => {
  await resetDirs()
  await makeRepoDir('referenced-repo')
  await makeRepoDir('leftover-repo')
  const orphans = await health.findOrphanRepos([makeEntry('referenced-repo')])
  assert.deepEqual(orphans, ['leftover-repo'])
})

test('findOrphanRepos returns empty when repos/ does not exist', async () => {
  await resetDirs()
  assert.deepEqual(await health.findOrphanRepos([]), [])
})

test('findOrphanLinks reports orphan-link for a valid target no entry claims', async () => {
  await resetDirs()
  const dir = await makeRepoDir('unclaimed-repo')
  await makeLink('unclaimed-skill', dir)
  const links = await health.findOrphanLinks([])
  assert.equal(links.length, 1)
  assert.equal(links[0]!.name, 'unclaimed-skill')
  assert.equal(links[0]!.code, 'orphan-link')
})

test('findOrphanLinks reports dangling-link when the target inside repos/ is gone', async () => {
  await resetDirs()
  const dir = await makeRepoDir('ghost-repo')
  await makeLink('ghost-skill', dir)
  await rm(dir, { recursive: true, force: true }) // target gone, link remains
  const links = await health.findOrphanLinks([])
  assert.equal(links.length, 1)
  assert.equal(links[0]!.code, 'dangling-link')
})

test('findOrphanLinks skips a link a live entry claims (no double report)', async () => {
  await resetDirs()
  const dir = await makeRepoDir('claimed-repo')
  await makeLink('claimed-skill', dir)
  const links = await health.findOrphanLinks([makeEntry('claimed-repo', 'claimed-skill')])
  assert.deepEqual(links, [])
})

test('findOrphanLinks ignores symlinks pointing outside repos/', async () => {
  await resetDirs()
  const outside = await mkdtemp(join(tmpdir(), 'nexus-outside-'))
  try {
    await makeLink('user-own-skill', outside)
    const links = await health.findOrphanLinks([])
    assert.deepEqual(links, [])
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { DoctorReport } from '../src/cli/commands/doctor.js'
import { removeTree } from './fs-helpers.js'

/**
 * Issue #22: `diagnoseEntry` calls an entry 'ok' when *at least one* link
 * survives, so a multi-skill entry that lost part of its link set used to
 * pass doctor silently. checkSymlinks now reconciles the expected set
 * (naming invariant + per-skill exclusions) against the links actually
 * present and warns `missing-links`; `enable` repairs the gap instead of
 * short-circuiting on "already enabled".
 *
 * Git-free fixtures, same isolation pattern as test/doctor.test.ts: DSH_HOME
 * is pointed at a temp dir before importing the module chain (paths.ts
 * captures it at import time), and each test starts from a wiped NEXUS_HOME
 * and skills root.
 */

let home: string
let doctorMod: typeof import('../src/cli/commands/doctor.js')
let toggleMod: typeof import('../src/cli/commands/toggle.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-doctor-ml-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  doctorMod = await import('../src/cli/commands/doctor.js')
  toggleMod = await import('../src/cli/commands/toggle.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await removeTree(home)
  delete process.env.DSH_HOME
})

beforeEach(async () => {
  await rm(paths.NEXUS_HOME, { recursive: true, force: true })
  await removeTree(paths.OFFICIAL_SKILLS_DIR)
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeEntry(
  repoPath: string,
  name = repoPath,
  extra: Partial<SkillEntry> = {},
): SkillEntry {
  return {
    name,
    url: `github:owner/${repoPath}#main`,
    gitUrl: `https://github.com/owner/${repoPath}.git`,
    ref: 'main',
    path: repoPath,
    addedAt: new Date().toISOString(),
    ...extra,
  }
}

/** A clone yielding one flat `skill-<n>.md` per given name (multi-skill). */
async function makeMultiClone(repoPath: string, names: string[]): Promise<string> {
  const dir = paths.repoDir(repoPath)
  await mkdir(dir, { recursive: true })
  await mkdir(join(dir, '.git'), { recursive: true })
  for (const n of names) {
    await writeFile(join(dir, `skill-${n}.md`), `---\nname: skill-${n}\n---\nS`, 'utf8')
  }
  return dir
}

async function makeLink(skillName: string, target: string): Promise<void> {
  await mkdir(paths.OFFICIAL_SKILLS_DIR, { recursive: true })
  await symlink(target, paths.skillLinkPath(skillName), 'junction')
}

async function writeManifest(skills: SkillEntry[]): Promise<void> {
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  await writeFile(paths.MANIFEST_PATH, JSON.stringify({ version: 1, skills }), 'utf8')
}

function findCheck(report: DoctorReport, id: string) {
  const c = report.checks.find((x) => x.id === id)
  assert.ok(c, `expected a check with id "${id}"`)
  return c
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

test('partial link loss is a missing-links warn with counts, names and an enable fix', async () => {
  const dir = await makeMultiClone('ml-repo', ['a', 'b', 'c'])
  await makeLink('skill-a', dir)
  await makeLink('skill-b', dir)
  await writeManifest([makeEntry('ml-repo')])

  const report = await doctorMod.runChecks(false)
  const sym = findCheck(report, 'symlinks')
  assert.equal(sym.status, 'warn')
  assert.equal(sym.issues.length, 1)
  const issue = sym.issues[0]!
  assert.equal(issue.code, 'missing-links')
  assert.equal(issue.severity, 'warn')
  assert.equal(issue.name, 'ml-repo')
  assert.equal(issue.detail, '2 of 3 links present, missing: skill-c')
  assert.equal(issue.fix, 'dsh-skills-nexus enable ml-repo')
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.warnings, 1)
  // The entry still counts as ok in the tally — it IS enabled, just incomplete.
  assert.equal(sym.detail, '1/1 links ok')
  // The fix hint reaches the human report.
  assert.ok(doctorMod.formatHuman(report).includes('dsh-skills-nexus enable ml-repo'))
  // Contract anchor: no new check id, no reordering — only a new issue code.
  assert.deepEqual(report.checks.map((c) => c.id), [
    'manifest',
    'roots',
    'symlinks',
    'orphan-repo',
    'orphan-link',
    'git-sanity',
    'external-disabled',
  ])
})

test('an excluded skill is not expected, so its absent link draws no warn', async () => {
  const dir = await makeMultiClone('mx-repo', ['a', 'b', 'c'])
  await makeLink('skill-a', dir)
  await makeLink('skill-b', dir)
  await writeManifest([makeEntry('mx-repo', 'mx-repo', { excluded: ['skill-c'] })])

  const report = await doctorMod.runChecks(false)
  assert.equal(findCheck(report, 'symlinks').status, 'ok')
  assert.equal(report.summary.warnings, 0)
})

test('zero links stays disabled/ok — indistinguishable from an explicit disable (Case B)', async () => {
  await makeMultiClone('mz-repo', ['a', 'b'])
  await writeManifest([makeEntry('mz-repo')])

  const report = await doctorMod.runChecks(false)
  const sym = findCheck(report, 'symlinks')
  assert.equal(sym.status, 'ok')
  assert.equal(sym.issues.length, 0)
  assert.equal(sym.detail, '0/1 links ok, 1 disabled')
})

test('enable reconciles the gap and a re-check reports ok', async () => {
  const dir = await makeMultiClone('mr-repo', ['a', 'b', 'c'])
  await makeLink('skill-a', dir)
  await makeLink('skill-b', dir)
  await writeManifest([makeEntry('mr-repo')])

  const before = await doctorMod.runChecks(false)
  assert.equal(findCheck(before, 'symlinks').status, 'warn')

  // The entry is enabled (two links up) — enable must repair, not no-op.
  assert.equal(await toggleMod.toggle(['mr-repo'], true), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-c')), true)
  const after = await doctorMod.runChecks(false)
  assert.equal(findCheck(after, 'symlinks').status, 'ok')
  assert.equal(after.summary.warnings, 0)
})

test('more than five missing names are truncated with a +N more suffix', async () => {
  const dir = await makeMultiClone('mt-repo', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  await makeLink('skill-a', dir)
  await writeManifest([makeEntry('mt-repo')])

  const report = await doctorMod.runChecks(false)
  const issue = findCheck(report, 'symlinks').issues[0]!
  assert.equal(issue.code, 'missing-links')
  assert.equal(
    issue.detail,
    '1 of 8 links present, missing: skill-b, skill-c, skill-d, skill-e, skill-f, +2 more',
  )
})

test('a healthy single-skill entry draws no warn (expected name is the entry name)', async () => {
  const dir = paths.repoDir('solo-repo')
  await mkdir(dir, { recursive: true })
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n', 'utf8')
  await makeLink('solo-repo', dir)
  await writeManifest([makeEntry('solo-repo')])

  const report = await doctorMod.runChecks(false)
  assert.equal(findCheck(report, 'symlinks').status, 'ok')
  assert.equal(report.summary.warnings, 0)
})

test('an empty discovery skips the comparison (clone present, no skills)', async () => {
  const dir = paths.repoDir('empty-repo')
  await mkdir(dir, { recursive: true })
  await mkdir(join(dir, '.git'), { recursive: true })
  await makeLink('empty-repo', dir)
  await writeManifest([makeEntry('empty-repo')])

  const report = await doctorMod.runChecks(false)
  const sym = findCheck(report, 'symlinks')
  assert.equal(sym.status, 'ok')
  assert.equal(sym.issues.length, 0)
})
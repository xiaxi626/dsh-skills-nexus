import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { DoctorReport } from '../src/cli/commands/doctor.js'
import { DANGLING_LINKS_OBSERVABLE, removeTree } from './fs-helpers.js'

/**
 * See the marker's own comment in test/fs-helpers.ts: on Windows a link whose
 * target has been deleted cannot be staged or observed, so the three checks
 * below self-skip there instead of asserting a classification no filesystem
 * call could have reached.
 */
const DANGLING_LINK_OPAQUE = !DANGLING_LINKS_OBSERVABLE

/**
 * Integration tests for the `doctor` command (`src/cli/commands/doctor.ts`).
 *
 * DSH_HOME is pointed at a temp dir before importing the module chain (paths.ts
 * captures it at import time). Each test starts from a wiped NEXUS_HOME and
 * skills root, so scenarios never leak into one another.
 */

let home: string
let doctorMod: typeof import('../src/cli/commands/doctor.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-doctor-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  doctorMod = await import('../src/cli/commands/doctor.js')
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

/** Create a clone dir under repos/ with a SKILL.md and (by default) a .git. */
async function makeClone(repoPath: string, opts: { git?: boolean } = {}): Promise<string> {
  const dir = paths.repoDir(repoPath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n', 'utf8')
  if (opts.git !== false) await mkdir(join(dir, '.git'), { recursive: true })
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

/** Capture whatever `fn()` writes to stdout, returning it as a string. */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const orig = process.stdout.write
  let buf = ''
  process.stdout.write = ((chunk: string): boolean => {
    buf += chunk
    return true
  }) as unknown as typeof process.stdout.write
  try {
    await fn()
  } finally {
    process.stdout.write = orig
  }
  return buf
}

/* ------------------------------------------------------------------ */
/* Scenario tests                                                      */
/* ------------------------------------------------------------------ */

test('fresh install (no manifest, no roots) is all ok, exit 0', async () => {
  const report = await doctorMod.runChecks(false)
  assert.equal(report.summary.errors, 0)
  assert.equal(findCheck(report, 'manifest').status, 'ok')
  assert.equal(findCheck(report, 'roots').status, 'ok')
  await captureStdout(async () => {
    assert.equal(await doctorMod.doctor([]), 0)
  })
})

test('a healthy install reports ok across checks', async () => {
  const dir = await makeClone('good-repo')
  await makeLink('good-skill', dir)
  await writeManifest([makeEntry('good-repo', 'good-skill')])
  const report = await doctorMod.runChecks(false)
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.warnings, 0)
  assert.equal(findCheck(report, 'symlinks').status, 'ok')
  assert.equal(findCheck(report, 'git-sanity').status, 'ok')
  assert.equal(findCheck(report, 'orphan-repo').status, 'ok')
  assert.equal(findCheck(report, 'orphan-link').status, 'ok')
})

test('a broken symlink is an error (missing-target), exit 1', { skip: DANGLING_LINK_OPAQUE && 'platform cannot stage or observe a dangling link' }, async () => {
  const dir = await makeClone('broken-repo')
  await makeLink('broken-skill', dir)
  await rm(dir, { recursive: true, force: true })
  await writeManifest([makeEntry('broken-repo', 'broken-skill')])
  const report = await doctorMod.runChecks(false)
  const sym = findCheck(report, 'symlinks')
  assert.equal(sym.status, 'error')
  assert.equal(sym.issues[0]!.code, 'missing-target')
  assert.ok(report.summary.errors >= 1)
  // The dangling link is claimed by a live entry, so orphan-link must not
  // double-report it.
  assert.equal(findCheck(report, 'orphan-link').issues.length, 0)
  await captureStdout(async () => {
    assert.equal(await doctorMod.doctor([]), 1)
  })
})

test('a leftover clone is orphan-repo (warn)', async () => {
  await makeClone('leftover')
  await writeManifest([])
  const report = await doctorMod.runChecks(false)
  const oc = findCheck(report, 'orphan-repo')
  assert.equal(oc.status, 'warn')
  assert.equal(oc.issues[0]!.code, 'orphan-repo')
  assert.equal(report.summary.errors, 0)
})

test('an unclaimed valid symlink is orphan-link (warn)', async () => {
  const dir = await makeClone('unclaimed')
  await makeLink('unclaimed-skill', dir)
  await writeManifest([])
  const report = await doctorMod.runChecks(false)
  const link = findCheck(report, 'orphan-link').issues.find((i) => i.code === 'orphan-link')
  assert.ok(link)
  assert.equal(link.name, 'unclaimed-skill')
  assert.equal(link.severity, 'warn')
})

test('a dangling symlink into repos/ with no entry is dangling-link (error)', { skip: DANGLING_LINK_OPAQUE && 'platform cannot stage or observe a dangling link' }, async () => {
  const dir = await makeClone('ghost')
  await makeLink('ghost-skill', dir)
  await rm(dir, { recursive: true, force: true })
  await writeManifest([]) // nothing claims it
  const report = await doctorMod.runChecks(false)
  const d = findCheck(report, 'orphan-link').issues.find((i) => i.code === 'dangling-link')
  assert.ok(d)
  assert.equal(d.severity, 'error')
  assert.ok(report.summary.errors >= 1)
})

test('a corrupt manifest is an error', async () => {
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  await writeFile(paths.MANIFEST_PATH, '{ not json', 'utf8')
  const report = await doctorMod.runChecks(false)
  const m = findCheck(report, 'manifest')
  assert.equal(m.status, 'error')
  assert.equal(m.issues[0]!.code, 'corrupt-manifest')
})

test('a corrupt manifest suppresses orphan checks (no mass-delete false positives)', async () => {
  // A healthy clone + link exist, but the manifest is unreadable. Ownership is
  // unknown, so orphan checks must be SKIPPED 鈥?never flag everything for deletion.
  const dir = await makeClone('good-repo')
  await makeLink('good-skill', dir)
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  await writeFile(paths.MANIFEST_PATH, '{ not json', 'utf8')

  const report = await doctorMod.runChecks(false)
  assert.equal(findCheck(report, 'manifest').status, 'error')

  const repo = findCheck(report, 'orphan-repo')
  const link = findCheck(report, 'orphan-link')
  assert.equal(repo.status, 'warn')
  assert.equal(link.status, 'warn')
  // Each skipped check carries ONE non-actionable warn issue (no delete hint),
  // so the warn label is reflected in the summary count.
  assert.equal(repo.issues.length, 1)
  assert.equal(repo.issues[0]!.code, 'orphan-check-skipped')
  assert.equal(link.issues.length, 1)
  assert.equal(link.issues[0]!.code, 'orphan-check-skipped')
  assert.equal(report.summary.warnings, 2)
  // The healthy clone + link must NOT be flagged as orphans.
  assert.ok(
    !report.checks.some((c) =>
      c.issues.some((i) => ['orphan-repo', 'orphan-link', 'dangling-link'].includes(i.code)),
    ),
    'healthy clone/link must not be reported as orphans when the manifest is corrupt',
  )
  // No issue anywhere may carry a delete hint while ownership is unknown.
  for (const c of report.checks) {
    for (const i of c.issues) {
      assert.ok(!(i.fix ?? '').includes('remove'), `unexpected delete hint: ${i.fix}`)
    }
  }
})

test('a manifest with a malformed entry is corrupt-manifest and does not throw', async () => {
  await mkdir(paths.NEXUS_HOME, { recursive: true })
  // Parseable JSON, correct version, but the entry is missing required fields 鈥?
  // must be reported structurally, not crash downstream repoDir()/readlink().
  await writeFile(
    paths.MANIFEST_PATH,
    JSON.stringify({ version: 1, skills: [{ name: 'x' }] }),
    'utf8',
  )
  const report = await doctorMod.runChecks(false)
  const m = findCheck(report, 'manifest')
  assert.equal(m.status, 'error')
  assert.equal(m.issues[0]!.code, 'corrupt-manifest')
  assert.equal(findCheck(report, 'orphan-repo').status, 'warn')
})

test('a .corrupt- backup file is a warn', async () => {
  await writeManifest([])
  await writeFile(`${paths.MANIFEST_PATH}.corrupt-123`, 'old', 'utf8')
  const report = await doctorMod.runChecks(false)
  const m = findCheck(report, 'manifest')
  assert.ok(m.issues.some((i) => i.code === 'corrupt-backup'))
  assert.equal(m.status, 'warn')
})

test('a clone missing .git is git-sanity warn', async () => {
  const dir = await makeClone('nogit', { git: false })
  await makeLink('nogit-skill', dir)
  await writeManifest([makeEntry('nogit', 'nogit-skill')])
  const report = await doctorMod.runChecks(false)
  const g = findCheck(report, 'git-sanity')
  assert.equal(g.status, 'warn')
  assert.equal(g.issues[0]!.code, 'missing-git')
})

/* ------------------------------------------------------------------ */
/* Source-less entries (搂2.1 form (b) / 搂6.2 doctor 鍒嗘祦)              */
/* ------------------------------------------------------------------ */

/** A snapshot entry: empty git fields are structural, not corruption. */
function makeSnapshotEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    name: 'snap-pack',
    url: 'package:pack.zip',
    gitUrl: '',
    ref: '',
    path: 'snap-pack',
    addedAt: new Date().toISOString(),
    ...overrides,
  }
}

test('a source-less entry passes the manifest shape check (empty git fields are structural)', async () => {
  const dir = await makeClone('snap-pack', { git: false })
  await makeLink('snap-skill', dir)
  await writeManifest([makeSnapshotEntry({ name: 'snap-skill' })])
  const report = await doctorMod.runChecks(false)
  assert.equal(findCheck(report, 'manifest').status, 'ok')
  assert.match(findCheck(report, 'manifest').detail ?? '', /1 entry/)
  // Trusted manifest 鈫?orphan checks run instead of being skipped.
  assert.equal(findCheck(report, 'orphan-repo').status, 'ok')
  assert.equal(findCheck(report, 'orphan-link').status, 'ok')
  assert.equal(findCheck(report, 'symlinks').status, 'ok')
  assert.equal(report.summary.errors, 0)
})

test('git-sanity skips source-less entries entirely (no missing-git, no tally)', async () => {
  await makeClone('snap-pack', { git: false })
  await writeManifest([makeSnapshotEntry()])
  const report = await doctorMod.runChecks(false)
  const g = findCheck(report, 'git-sanity')
  assert.equal(g.status, 'ok')
  assert.equal(g.issues.length, 0)
  assert.equal(g.detail, 'no clones')
})

test('git-sanity counts only git clones in a mixed manifest', async () => {
  await makeClone('nogit-mix', { git: false })
  await makeClone('snap-mix', { git: false })
  await writeManifest([
    makeEntry('nogit-mix'),
    makeSnapshotEntry({ name: 'snap-mix', path: 'snap-mix' }),
  ])
  const report = await doctorMod.runChecks(false)
  const g = findCheck(report, 'git-sanity')
  assert.equal(g.issues.length, 1)
  assert.equal(g.issues[0]!.name, 'nogit-mix')
  assert.equal(g.detail, '0/1 clones have .git')
})

test('missing-target on a source-less entry suggests reinstall, not update', { skip: DANGLING_LINK_OPAQUE && 'platform cannot stage or observe a dangling link' }, async () => {
  const dir = await makeClone('snap-broken', { git: false })
  await makeLink('snap-broken-skill', dir)
  await rm(dir, { recursive: true, force: true })
  await writeManifest([makeSnapshotEntry({ name: 'snap-broken-skill', path: 'snap-broken' })])
  const report = await doctorMod.runChecks(false)
  const sym = findCheck(report, 'symlinks')
  assert.equal(sym.issues[0]!.code, 'missing-target')
  assert.match(sym.issues[0]!.fix ?? '', /remove snap-broken-skill/)
  assert.ok(!(sym.issues[0]!.fix ?? '').includes('update'))
})

test('doctor --updates stays silent for source-less entries (not-applicable)', async () => {
  await makeClone('snap-pack', { git: false })
  await writeManifest([makeSnapshotEntry()])
  const report = await doctorMod.runChecks(true)
  const u = findCheck(report, 'updates')
  assert.equal(
    u.issues.filter((i) => i.name === 'snap-pack').length,
    0,
  )
})

test('doctor distinguishes an explicit import lock from an ordinary detached pin', async () => {
  await makeClone('explicit-lock')
  await makeClone('detached-pin')
  await writeManifest([
    makeEntry('explicit-lock', 'explicit-lock', {
      commit: 'a'.repeat(40),
      locked: true,
    }),
    makeEntry('detached-pin', 'detached-pin', {
      ref: 'v1.0.0',
      commit: 'b'.repeat(40),
    }),
  ])

  const updates = findCheck(await doctorMod.runChecks(true), 'updates')
  const explicit = updates.issues.find((i) => i.name === 'explicit-lock')
  const detached = updates.issues.find((i) => i.name === 'detached-pin')
  assert.equal(explicit?.code, 'locked')
  assert.equal(explicit?.locked, true)
  assert.match(explicit?.detail ?? '', /exact package commit/)
  assert.equal(detached?.code, 'locked')
  assert.equal(detached?.locked, undefined)
  assert.match(detached?.detail ?? '', /pinned at v1\.0\.0/)
})

/* ------------------------------------------------------------------ */
/* external-disabled check (搂1.5 / 搂6.2)                               */
/* ------------------------------------------------------------------ */

test('external *.disabled markers are reported as external-disabled (warn)', async () => {
  const dir = await makeClone('marked-repo')
  await writeFile(join(dir, 'SKILL.md.disabled'), 'renamed by skill-hub\n', 'utf8')
  await makeLink('marked-skill', dir)
  await writeManifest([makeEntry('marked-repo', 'marked-skill')])
  const report = await doctorMod.runChecks(false)
  const ext = findCheck(report, 'external-disabled')
  assert.equal(ext.status, 'warn')
  assert.equal(ext.issues.length, 1)
  assert.equal(ext.issues[0]!.code, 'external-disabled')
  assert.match(ext.issues[0]!.detail ?? '', /SKILL\.md\.disabled/)
  // Caution: no fix/delete hint 鈥?the marker belongs to the external tool.
  assert.equal(ext.issues[0]!.fix, undefined)
})

test('external-disabled scans nested skill dirs but prunes .git', async () => {
  const dir = await makeClone('nested-repo')
  await mkdir(join(dir, 'sub', 'skill'), { recursive: true })
  await writeFile(join(dir, 'sub', 'skill', 'SKILL.md.disabled'), 'x\n', 'utf8')
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true })
  await writeFile(join(dir, '.git', 'hooks', 'pre-commit.disabled'), 'x\n', 'utf8')
  await writeManifest([makeEntry('nested-repo')])
  const report = await doctorMod.runChecks(false)
  const ext = findCheck(report, 'external-disabled')
  assert.equal(ext.issues.length, 1)
  assert.match(ext.issues[0]!.detail ?? '', /sub\/skill\/SKILL\.md\.disabled/)
  assert.ok(!(ext.issues[0]!.detail ?? '').includes('pre-commit'))
})

test('external-disabled is appended after the long-standing checks', async () => {
  await writeManifest([])
  const report = await doctorMod.runChecks(false)
  const ids = report.checks.map((c) => c.id)
  assert.deepEqual(ids, [
    'manifest',
    'roots',
    'symlinks',
    'orphan-repo',
    'orphan-link',
    'git-sanity',
    'external-disabled',
  ])
})

/* ------------------------------------------------------------------ */
/* Output contract & usage                                             */
/* ------------------------------------------------------------------ */

test('--json emits a version-1 report with no top-level issues array', async () => {
  await writeManifest([])
  const out = await captureStdout(() => doctorMod.doctor(['--json']))
  const parsed = JSON.parse(out) as DoctorReport & { issues?: unknown }
  assert.equal(parsed.version, 1)
  assert.ok(Array.isArray(parsed.checks))
  assert.equal(typeof parsed.summary.errors, 'number')
  assert.equal(parsed.issues, undefined)
})

test('--quiet suppresses output when there is no error', async () => {
  await writeManifest([])
  const out = await captureStdout(() => doctorMod.doctor(['--quiet']))
  assert.equal(out, '')
})

test('positional args, inline flag values and unknown options are usage errors (exit 2)', async () => {
  assert.equal(await doctorMod.doctor(['foo']), 2)
  assert.equal(await doctorMod.doctor(['--json=x']), 2)
  assert.equal(await doctorMod.doctor(['--nope']), 2)
})

test('parseDoctorArgs parses boolean flags and rejects values', () => {
  assert.deepEqual(doctorMod.parseDoctorArgs(['--json', '--updates', '--quiet']), {
    json: true,
    updates: true,
    quiet: true,
  })
  assert.throws(() => doctorMod.parseDoctorArgs(['--json=1']))
  assert.throws(() => doctorMod.parseDoctorArgs(['x']))
})

test('formatHuman renders status labels and fix hints', () => {
  const report: DoctorReport = {
    version: 1,
    checks: [
      { id: 'manifest', status: 'ok', detail: '0 entries', issues: [] },
      {
        id: 'symlinks',
        status: 'error',
        issues: [
          { severity: 'error', code: 'missing-target', name: 'x', fix: 'dsh-skills-nexus update x' },
        ],
      },
    ],
    summary: { errors: 1, warnings: 0, updates: 0 },
  }
  const out = doctorMod.formatHuman(report)
  assert.ok(out.includes('manifest'))
  assert.ok(out.includes('FAIL'))
  assert.ok(out.includes('1 error(s)'))
  assert.ok(out.includes('dsh-skills-nexus update x'))
})

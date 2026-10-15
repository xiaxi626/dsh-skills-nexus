import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Tests for the `remove --group` batch deletion.
 *
 * The promise under test is that `remove --group <path>` deletes every entry
 * whose `groupPath` starts with the given prefix, segment by segment (the same
 * rule `toggle --group` uses), is mutually exclusive with name patterns, and
 * keeps the destructive-op guard: a group matching several entries is confirmed
 * first (or skips the prompt with `--yes`), while an empty group is an error.
 *
 * External entries only link a directory the user owns, so removal must never
 * delete that directory — the isolation is asserted here.
 *
 * paths.ts reads DSH_HOME at import time, so the env var is set before the
 * dynamic import (test/remove.test.ts pattern).
 */

let home: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let removeMod: typeof import('../src/cli/commands/remove.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-remove-group-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  removeMod = await import('../src/cli/commands/remove.js')
  assert.ok(
    paths.OFFICIAL_SKILLS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.OFFICIAL_SKILLS_DIR}`,
  )
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function names(): Promise<string[]> {
  return (await manifest.readManifest()).skills.map((s) => s.name)
}

/** Reset the manifest to nothing, dropping the links left by prior tests. */
async function clearManifest(): Promise<void> {
  for (const entry of (await manifest.readManifest()).skills) {
    await rm(paths.skillLinkPath(entry.name), { force: true })
    await manifest.removeEntry(entry.name)
  }
  const skillsDir = paths.OFFICIAL_SKILLS_DIR
  try {
    for (const e of await readdir(skillsDir)) await rm(join(skillsDir, e), { force: true })
  } catch {
    // skills dir may not exist yet
  }
}

/** Seed an external entry with a `groupPath`, its dir, SKILL.md and symlink. */
async function seedExternalEntry(
  name: string,
  groupPath: string[],
  externalDir: string,
): Promise<void> {
  const entry: SkillEntry = {
    name,
    url: `trae-cn:${groupPath.slice(1).join('/')}`,
    gitUrl: '',
    ref: '',
    ownership: 'external',
    path: externalDir,
    addedAt: new Date().toISOString(),
    externalDir,
    groupPath,
  }
  await manifest.addEntry(entry)
  await mkdir(externalDir, { recursive: true })
  // A SKILL.md so previewSkills resolves the single-skill link name.
  await writeFile(
    join(externalDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n\nBody.\n`,
  )
  const linkPath = paths.skillLinkPath(name)
  await mkdir(dirname(linkPath), { recursive: true })
  await symlink(externalDir, linkPath, 'junction')
}

/** Seed a managed (git-clone) entry — no `groupPath`, so `--group` can't match it. */
async function seedManagedEntry(name: string): Promise<void> {
  await manifest.addEntry({
    name,
    url: `github:owner/${name}`,
    gitUrl: `https://github.com/owner/${name}.git`,
    ref: 'main',
    path: name,
    addedAt: new Date().toISOString(),
  })
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

interface Captured {
  io: OpsIO
  lines: string[]
  errors: string[]
}

/**
 * A capturing `OpsIO`. Real `emit`/`error` channels (the JSON report is written
 * through `emit`; diagnostics go to `error`), and a configurable `interactive`
 * flag driving the confirmation guard's two branches.
 */
function captureIO(opts: { interactive?: boolean; confirm?: () => Promise<boolean> } = {}): Captured {
  const lines: string[] = []
  const errors: string[] = []
  const io: OpsIO = {
    interactive: opts.interactive ?? false,
    confirm: opts.confirm ?? (async () => true),
    progress: () => {},
    emit: (line: string) => {
      lines.push(line)
    },
    error: (line: string) => {
      errors.push(line)
    },
  }
  return { io, lines, errors }
}

/** The last emitted line parsed as the version-1 machine report. */
function jsonReport(captured: Captured): {
  version: number
  results: unknown[]
  summary: { removed: number; failed: number }
} {
  const line = captured.lines.at(-1)
  assert.ok(line, 'the report was emitted')
  return JSON.parse(line) as ReturnType<typeof jsonReport>
}

/* ------------------------------------------------------------------ */
/* Group matching + deletion                                          */
/* ------------------------------------------------------------------ */

test('remove --group <prefix> --yes deletes every entry under the group', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'ga-alpha'))
  await seedExternalEntry('trae-cn.builtin.gamma', ['trae-cn', 'builtin', 'gamma'], join(home, 'ga-gamma'))
  await seedExternalEntry('other.skills.delta', ['other', 'skills', 'delta'], join(home, 'ga-delta'))
  // A managed entry has no groupPath: `--group` must not reach it.
  await seedManagedEntry('managed-a')

  const { io, errors } = captureIO()
  assert.equal(await removeMod.remove(['--group', 'trae-cn', '--yes'], io), 0, errors.join(''))

  assert.deepEqual((await names()).sort(), ['managed-a', 'other.skills.delta'])
  // The user-owned external directories survive removal; only the entry goes.
  assert.equal(await exists(join(home, 'ga-alpha')), true)
  assert.equal(await exists(join(home, 'ga-gamma')), true)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), false)
})

test('remove --group matches whole path segments, not a string prefix', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gb-alpha'))

  // 'trae-cn/skill' (missing the final 's') must not sweep up 'trae-cn/skills/*'.
  // An empty group is an error regardless of --yes, and nothing is deleted.
  const miss = captureIO()
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skill', '--yes'], miss.io), 1)
  assert.ok(miss.errors.join('').includes('no entries match group'))
  assert.deepEqual(await names(), ['trae-cn.skills.alpha'])

  const hit = captureIO()
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skills', '--yes'], hit.io), 0)
  assert.deepEqual(await names(), [])
})

test('remove --group is mutually exclusive with name patterns (exit 2)', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gc-alpha'))

  const { io, errors } = captureIO()
  assert.equal(await removeMod.remove(['--group', 'trae-cn', 'alpha'], io), 2)
  assert.ok(errors.join('').includes('--group cannot be combined with name patterns'))
  assert.deepEqual(await names(), ['trae-cn.skills.alpha'])
})

test('remove --group with no match is an error on a human run (exit 1)', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gd-alpha'))

  const { io, errors } = captureIO()
  assert.equal(await removeMod.remove(['--group', 'nope'], io), 1)
  assert.ok(errors.some((e) => e.includes('no entries match group "nope"')))
  assert.deepEqual(await names(), ['trae-cn.skills.alpha'])
})

test('remove --group with no match answers the machine shape under --json (exit 1)', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'ge-alpha'))

  const captured = captureIO()
  assert.equal(await removeMod.remove(['--group', 'nope', '--json'], captured.io), 1)
  assert.deepEqual(jsonReport(captured), {
    version: 1,
    results: [],
    summary: { removed: 0, failed: 1 },
  })
  assert.ok(captured.errors.join('').includes('error: no entries match group "nope"'))
  assert.deepEqual(await names(), ['trae-cn.skills.alpha'])
})

/* ------------------------------------------------------------------ */
/* Confirmation guard                                                  */
/* ------------------------------------------------------------------ */

test('remove --group matching several entries is refused on a non-TTY (exit 2)', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gf-alpha'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'gf-beta'))

  const { io, errors } = captureIO({ interactive: false })
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skills'], io), 2)
  assert.ok(errors.join('').includes('Refusing to remove multiple skills'))
  assert.deepEqual((await names()).sort(), ['trae-cn.skills.alpha', 'trae-cn.skills.beta'])
})

test('remove --group without --yes still refuses in a JSON run (exit 2, machine shape)', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gg-alpha'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'gg-beta'))

  const { io, errors } = captureIO({ interactive: false })
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skills', '--json'], io), 2)
  const fatal = JSON.parse(errors.at(-1)!) as { version: number; error: { message: string } }
  assert.equal(fatal.version, 1)
  assert.ok(fatal.error.message.includes('Refusing to remove multiple skills'))
  assert.deepEqual((await names()).sort(), ['trae-cn.skills.alpha', 'trae-cn.skills.beta'])
})

test('remove --group prompts on an interactive terminal and proceeds when confirmed', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gh-alpha'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'gh-beta'))

  const { io } = captureIO({ interactive: true, confirm: async () => true })
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skills'], io), 0)
  assert.deepEqual(await names(), [])
})

test('remove --group aborts when the confirmation is declined (nothing removed)', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gi-alpha'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'gi-beta'))

  const { io, lines } = captureIO({ interactive: true, confirm: async () => false })
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skills'], io), 0)
  assert.ok(lines.join('').includes('Aborted'))
  assert.deepEqual((await names()).sort(), ['trae-cn.skills.alpha', 'trae-cn.skills.beta'])
})

test('remove --group with a single match needs no --yes', async () => {
  await clearManifest()
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'gj-alpha'))

  const { io, errors } = captureIO({ interactive: false })
  assert.equal(await removeMod.remove(['--group', 'trae-cn/skills'], io), 0, errors.join(''))
  assert.deepEqual(await names(), [])
})

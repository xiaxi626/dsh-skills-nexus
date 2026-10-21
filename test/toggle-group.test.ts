import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, lstat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { OpsIO } from '../src/ops-io.js'
import { removeTree } from './fs-helpers.js'

/**
 * Tests for the `--group` toggle extension.
 *
 * The promise under test is that `toggle --group <path>` batch-enables or
 * batch-disables every entry whose `groupPath` starts with the given prefix.
 * The group path uses `/` as separator (e.g. `trae-cn/skills` matches all
 * entries under `['trae-cn', 'skills', ...]`).
 *
 * Group state is derived from member entries, not stored independently.
 */

let home: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let toggleMod: typeof import('../src/cli/commands/toggle.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-toggle-group-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  toggleMod = await import('../src/cli/commands/toggle.js')
  assert.ok(
    paths.OFFICIAL_SKILLS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.OFFICIAL_SKILLS_DIR}`,
  )
})

after(async () => {
  await removeTree(home)
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function clearManifest(): Promise<void> {
  for (const entry of (await manifest.readManifest()).skills) {
    // Remove the symlink first.
    const linkPath = paths.skillLinkPath(entry.name)
    await rm(linkPath, { force: true })
    await manifest.removeEntry(entry.name)
  }
  // Also remove any leftover symlinks from previous tests.
  const skillsDir = paths.OFFICIAL_SKILLS_DIR
  try {
    const entries = await (await import('node:fs/promises')).readdir(skillsDir)
    for (const e of entries) {
      await rm(join(skillsDir, e), { force: true })
    }
  } catch {
    // skills dir may not exist yet
  }
}

/** Create a fake external entry with a groupPath. */
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
  // Create the symlink to simulate an enabled entry.
  const linkPath = paths.skillLinkPath(name)
  await mkdir(externalDir, { recursive: true })
  // Write a SKILL.md so previewSkills can discover it on re-enable.
  await writeFile(join(externalDir, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill\n---\n\nBody.\n`)
  await mkdir(dirname(linkPath), { recursive: true })
  await symlink(externalDir, linkPath, 'junction')
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

function captureIO(): { io: OpsIO; lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return {
    lines,
    errors,
    io: {
      confirm: async () => true,
      progress: () => {},
      emit: (line: string) => { lines.push(line) },
      error: (line: string) => { errors.push(line) },
      interactive: false,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Group prefix matching                                               */
/* ------------------------------------------------------------------ */

test('toggle --group matches entries by groupPath prefix', async () => {
  await clearManifest()

  // Seed entries with different group paths.
  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'alpha'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'beta'))
  await seedExternalEntry('trae-cn.builtin.gamma', ['trae-cn', 'builtin', 'gamma'], join(home, 'gamma'))
  await seedExternalEntry('other.skills.delta', ['other', 'skills', 'delta'], join(home, 'delta'))

  // All entries should be enabled initially.
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), true)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), true)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.builtin.gamma')), true)
  assert.equal(await exists(paths.skillLinkPath('other.skills.delta')), true)

  // Disable all entries under 'trae-cn/skills'.
  const { io, errors } = captureIO()
  const exitCode = await toggleMod.toggle(['--group', 'trae-cn/skills'], false, io)

  assert.equal(exitCode, 0, `toggle failed: ${errors.join('')}`)

  // Verify links were removed for matching entries.
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), false)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), false)

  // Other entries should still be enabled.
  assert.equal(await exists(paths.skillLinkPath('trae-cn.builtin.gamma')), true)
  assert.equal(await exists(paths.skillLinkPath('other.skills.delta')), true)
})

test('toggle --group with L1 prefix matches all entries under that group', async () => {
  await clearManifest()

  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'alpha2'))
  await seedExternalEntry('trae-cn.builtin.beta', ['trae-cn', 'builtin', 'beta'], join(home, 'beta2'))
  await seedExternalEntry('other.skills.gamma', ['other', 'skills', 'gamma'], join(home, 'gamma2'))

  // Disable all entries under 'trae-cn'.
  const { io } = captureIO()
  const exitCode = await toggleMod.toggle(['--group', 'trae-cn'], false, io)

  assert.equal(exitCode, 0)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), false)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.builtin.beta')), false)
  assert.equal(await exists(paths.skillLinkPath('other.skills.gamma')), true)
})

test('toggle --group with no matching entries reports error', async () => {
  await clearManifest()

  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'alpha3'))

  const { io, errors } = captureIO()
  const exitCode = await toggleMod.toggle(['--group', 'nonexistent'], false, io)

  assert.equal(exitCode, 1)
  assert.ok(errors.some((e) => e.includes('no entries match')))
})

/* ------------------------------------------------------------------ */
/* Batch toggle                                                        */
/* ------------------------------------------------------------------ */

test('toggle --group enable re-creates links for disabled entries', async () => {
  await clearManifest()

  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'alpha4'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'beta4'))

  // Disable all.
  const { io: io1 } = captureIO()
  await toggleMod.toggle(['--group', 'trae-cn/skills'], false, io1)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), false)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), false)

  // Re-enable all.
  const { io: io2 } = captureIO()
  const exitCode = await toggleMod.toggle(['--group', 'trae-cn/skills'], true, io2)

  assert.equal(exitCode, 0)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), true)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), true)
})

/* ------------------------------------------------------------------ */
/* Derived group state                                                 */
/* ------------------------------------------------------------------ */

test('group state is derived from member entries', async () => {
  await clearManifest()

  await seedExternalEntry('trae-cn.skills.alpha', ['trae-cn', 'skills', 'alpha'], join(home, 'alpha5'))
  await seedExternalEntry('trae-cn.skills.beta', ['trae-cn', 'skills', 'beta'], join(home, 'beta5'))

  // Both enabled → group state is 'on'.
  const m1 = await manifest.readManifest()
  const entries1 = m1.skills.filter((s) => s.groupPath?.[0] === 'trae-cn' && s.groupPath?.[1] === 'skills')
  assert.equal(entries1.length, 2)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), true)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), true)

  // Disable one → group state is 'mixed'.
  const { io: io1 } = captureIO()
  await toggleMod.toggle(['trae-cn.skills.alpha'], false, io1)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), false)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), true)

  // Disable both → group state is 'off'.
  const { io: io2 } = captureIO()
  await toggleMod.toggle(['trae-cn.skills.beta'], false, io2)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.alpha')), false)
  assert.equal(await exists(paths.skillLinkPath('trae-cn.skills.beta')), false)
})

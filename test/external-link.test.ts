import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for the trae-cn link channel (`src/external.ts`).
 *
 * The promise under test is that `planLinkLocal` and `linkLocal` discover
 * skills from a trae-cn-like directory structure and register them as
 * external entries with the correct naming convention:
 *   - `groupPath` = `[group ?? source, subdir, dirName]`
 *   - `name` = `groupPath.join('.')`
 *   - `externalDir` = absolute path to the skill directory
 *
 * Conflicts with existing manifest entries are reported unless `--force`.
 * Unknown sources are refused with a `LinkError`.
 */

let home: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let external: typeof import('../src/external.js')
let linker: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-link-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  external = await import('../src/external.js')
  linker = await import('../src/link.js')
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

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody of ${name}.\n`
}

async function clearManifest(): Promise<void> {
  for (const entry of (await manifest.readManifest()).skills) {
    await manifest.removeEntry(entry.name)
  }
}

async function createTraeCnDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'nexus-link-trae-'))
}

async function seedTraeCnSkill(
  traeCnDir: string,
  subdir: 'skills' | 'builtin_skills',
  name: string,
): Promise<string> {
  const dir = join(traeCnDir, subdir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), skillMd(name))
  return dir
}

/* ------------------------------------------------------------------ */
/* planLinkLocal — naming convention                                   */
/* ------------------------------------------------------------------ */

test('planLinkLocal rejects unknown source with LinkError', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await assert.rejects(
      () => external.planLinkLocal('unknown-source', { traeCnDir }),
      (err: Error) => {
        assert.match(err.message, /unknown link source/)
        return true
      },
    )
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

test('planLinkLocal constructs groupPath as [source, subdir, dirName]', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skills', 'brainstorming')

    const plan = await external.planLinkLocal('trae-cn', { traeCnDir })
    assert.equal(plan.entries.length, 1)
    const entry = plan.entries[0]!
    assert.deepEqual(entry.groupPath, ['trae-cn', 'skills', 'brainstorming'])
    assert.equal(entry.name, 'trae-cn.skills.brainstorming')
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

test('planLinkLocal respects --group override for L1 name', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skills', 'my-skill')

    const plan = await external.planLinkLocal('trae-cn', { traeCnDir, group: 'custom-group' })
    assert.equal(plan.entries.length, 1)
    const entry = plan.entries[0]!
    assert.deepEqual(entry.groupPath, ['custom-group', 'skills', 'my-skill'])
    assert.equal(entry.name, 'custom-group.skills.my-skill')
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

test('planLinkLocal reports conflict when entry already exists', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skills', 'conflict-skill')

    // First plan: no conflict.
    const plan1 = await external.planLinkLocal('trae-cn', { traeCnDir })
    assert.equal(plan1.conflicts.length, 0)

    // Add the entry to the manifest.
    await manifest.addEntry({
      name: 'trae-cn.skills.conflict-skill',
      url: 'trae-cn:skills/conflict-skill',
      gitUrl: '',
      ref: '',
      ownership: 'external',
      path: join(traeCnDir, 'skills', 'conflict-skill'),
      addedAt: new Date().toISOString(),
      externalDir: join(traeCnDir, 'skills', 'conflict-skill'),
      groupPath: ['trae-cn', 'skills', 'conflict-skill'],
    })

    // Second plan: conflict reported.
    const plan2 = await external.planLinkLocal('trae-cn', { traeCnDir })
    assert.equal(plan2.conflicts.length, 1)
    assert.equal(plan2.conflicts[0], 'trae-cn.skills.conflict-skill')
    assert.equal(plan2.entries.length, 0)
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

test('planLinkLocal with --force bypasses conflict', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skills', 'force-skill')

    // Add the entry to the manifest.
    await manifest.addEntry({
      name: 'trae-cn.skills.force-skill',
      url: 'trae-cn:skills/force-skill',
      gitUrl: '',
      ref: '',
      ownership: 'external',
      path: join(traeCnDir, 'skills', 'force-skill'),
      addedAt: new Date().toISOString(),
      externalDir: join(traeCnDir, 'skills', 'force-skill'),
      groupPath: ['trae-cn', 'skills', 'force-skill'],
    })

    // With --force, the entry is in `entries` not `conflicts`.
    const plan = await external.planLinkLocal('trae-cn', { traeCnDir, force: true })
    assert.equal(plan.conflicts.length, 0)
    assert.equal(plan.entries.length, 1)
    assert.equal(plan.entries[0]!.name, 'trae-cn.skills.force-skill')
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* linkLocal — execution                                               */
/* ------------------------------------------------------------------ */

test('linkLocal creates manifest entries and symlinks', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    const skillDir = await seedTraeCnSkill(traeCnDir, 'skills', 'execute-skill')

    const io = {
      confirm: async () => true,
      progress: () => {},
      emit: () => {},
      error: () => {},
      interactive: false,
    }
    const { result } = await external.linkLocal('trae-cn', { traeCnDir }, io)

    assert.equal(result.added.length, 1)
    assert.equal(result.added[0], 'trae-cn.skills.execute-skill')

    // Verify the entry was created.
    const m = await manifest.readManifest()
    const entry = m.skills.find((s) => s.name === 'trae-cn.skills.execute-skill')
    assert.ok(entry, 'entry not created')
    assert.equal(entry.ownership, 'external')
    assert.equal(entry.externalDir, skillDir)
    assert.deepEqual(entry.groupPath, ['trae-cn', 'skills', 'execute-skill'])

    // Verify the symlink exists.
    const linkPath = paths.skillLinkPath('trae-cn.skills.execute-skill')
    const linkTarget = await linker.safeRealPath(linkPath)
    assert.equal(linkTarget, skillDir)
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

test('linkLocal reports not-found error for missing skill directory', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    // Create the parent directory but not the skill subdirectory.
    await mkdir(join(traeCnDir, 'skills'), { recursive: true })

    const io = {
      confirm: async () => true,
      progress: () => {},
      emit: () => {},
      error: () => {},
      interactive: false,
    }
    const { result } = await external.linkLocal('trae-cn', { traeCnDir }, io)
    assert.equal(result.added.length, 0)
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* discoverTraeCnSkills                                                */
/* ------------------------------------------------------------------ */

test('discoverTraeCnSkills finds skills in both subdirs', async () => {
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skills', 'skill-a')
    await seedTraeCnSkill(traeCnDir, 'builtin_skills', 'skill-b')

    const discovered = await external.discoverTraeCnSkills(traeCnDir)
    assert.equal(discovered.length, 2)
    const names = discovered.map((d) => d.name).sort()
    assert.deepEqual(names, ['skill-a', 'skill-b'])
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

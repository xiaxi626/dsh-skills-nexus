import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { removeTree } from './fs-helpers.js'

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
  await removeTree(home)
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

async function seedTraeCnSkill(traeCnDir: string, name: string): Promise<string> {
  const dir = join(traeCnDir, 'skills', name)
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
    await seedTraeCnSkill(traeCnDir, 'brainstorming')

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
    await seedTraeCnSkill(traeCnDir, 'my-skill')

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
    await seedTraeCnSkill(traeCnDir, 'conflict-skill')

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
    await seedTraeCnSkill(traeCnDir, 'force-skill')

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
    const skillDir = await seedTraeCnSkill(traeCnDir, 'execute-skill')

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
    assert.equal(await realpath(linkTarget), await realpath(skillDir))
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

test('source registry enables only the two Trae variants with independent defaults', () => {
  assert.deepEqual(external.SUPPORTED_SOURCES, ['trae-cn', 'trae'])
  assert.deepEqual(external.SOURCE_CONFIGS.trae, {
    envVar: 'TRAE_DIR', defaultDirName: '.trae', subdirs: ['skills'],
  })
  assert.deepEqual(external.SOURCE_CONFIGS['trae-cn'], {
    envVar: 'TRAE_CN_DIR', defaultDirName: '.trae-cn', subdirs: ['skills'],
  })
})

for (const source of ['trae-cn', 'trae']) {
  test(`resolveSourceRoots ${source}: override > own environment, missing override never falls back`, async () => {
    const root = await createTraeCnDir()
    const envVar = external.SOURCE_CONFIGS[source]!.envVar
    const previous = process.env[envVar]
    try {
      const override = join(root, 'override')
      await mkdir(override)
      process.env[envVar] = root
      assert.deepEqual(await external.resolveSourceRoots(source), [root])
      assert.deepEqual(await external.resolveSourceRoots(source, { dirOverride: override }), [override])
      const missing = join(root, 'missing')
      await assert.rejects(external.resolveSourceRoots(source, { dirOverride: missing }), (err: unknown) => {
        assert.ok(err instanceof external.LinkError)
        assert.equal(err.code, 'not-found')
        assert.ok(err.message.includes('--source-dir') && err.message.includes(envVar))
        return true
      })
      const file = join(root, 'file')
      await writeFile(file, '')
      await assert.rejects(external.resolveSourceRoots(source, { dirOverride: file }), { code: 'not-found' })
    } finally {
      if (previous === undefined) delete process.env[envVar]
      else process.env[envVar] = previous
      await removeTree(root)
    }
  })
}

for (const source of ['__proto__', 'constructor', 'toString']) {
  test(`prototype property ${source} is not a supported source`, async () => {
    await assert.rejects(external.planLinkLocal(source), (err: unknown) => {
      assert.ok(err instanceof external.LinkError)
      assert.equal(err.code, 'resolve-failed')
      assert.match(err.message, /supported sources: trae-cn, trae/)
      return true
    })
  })
}

test('multiple roots preserve priority, deduplicate paths and keep the first management name', async () => {
  await clearManifest()
  const base = await createTraeCnDir()
  const source = 'test-multiple-roots'
  const envVar = 'NEXUS_TEST_LINK_ROOT'
  const previous = process.env[envVar]
  delete process.env[envVar]
  try {
    const first = join(base, 'first'), second = join(base, 'second'), fallback = join(base, 'fallback')
    const firstSkill = await seedTraeCnSkill(first, 'shared')
    await seedTraeCnSkill(second, 'shared')
    await seedTraeCnSkill(second, 'second-only')
    await seedTraeCnSkill(fallback, 'fallback-only')
    external.SOURCE_CONFIGS[source] = {
      envVar,
      defaultDirName: relative(homedir(), fallback),
      rootCandidates: [join(relative(homedir(), base), 'missing'), relative(homedir(), first), relative(homedir(), second), relative(homedir(), first)],
      subdirs: ['skills'],
    }
    assert.deepEqual(await external.resolveSourceRoots(source), [first, second])
    const discovered = await external.discoverSkills([first, second, first], ['skills', 'skills'])
    assert.equal(discovered.length, 3)
    assert.equal(new Set(discovered.map((d) => d.dir)).size, 3)
    const plan = await external.planLinkLocal(source)
    assert.equal(plan.entries.length, 2)
    assert.equal(plan.entries.find((e) => e.name.endsWith('.shared'))!.externalDir, firstSkill)
    assert.ok(plan.entries.every((e) => !e.name.endsWith('.fallback-only')))
    await external.linkLocal(source)
    const conflict = await external.planLinkLocal(source)
    assert.equal(conflict.entries.length, 0)
    assert.equal(conflict.conflicts.length, 2)
    const forced = await external.linkLocal(source, { force: true })
    assert.equal(forced.result.added.length, 2)
    assert.equal((await manifest.readManifest()).skills.find((e) => e.name.endsWith('.shared'))!.externalDir, firstSkill)
    assert.deepEqual(await external.resolveSourceRoots(source, { dirOverride: fallback }), [fallback])
    process.env[envVar] = fallback
    assert.deepEqual(await external.resolveSourceRoots(source), [fallback])
    delete process.env[envVar]
    external.SOURCE_CONFIGS[source]!.rootCandidates = [relative(homedir(), join(base, 'missing'))]
    await assert.rejects(external.resolveSourceRoots(source), { code: 'not-found' })
    delete external.SOURCE_CONFIGS[source]!.rootCandidates
    assert.deepEqual(await external.resolveSourceRoots(source), [fallback])
  } finally {
    delete external.SOURCE_CONFIGS[source]
    if (previous === undefined) delete process.env[envVar]
    else process.env[envVar] = previous
    await removeTree(base)
  }
})

test('generic discovery supports subdirs but ignores hidden, nested and builtin skills', async () => {
  const root = await createTraeCnDir()
  try {
    await seedTraeCnSkill(root, 'visible')
    await seedTraeCnSkill(root, '.hidden')
    for (const sub of ['vendor', 'builtin_skills', 'skills/nested']) {
      const dir = join(root, sub, 'demo')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), skillMd('demo'))
    }
    await mkdir(join(root, 'skills', 'no-skill'))
    const discovered = await external.discoverSkills([root], ['skills', 'vendor', 'absent'])
    assert.deepEqual(discovered.map((d) => [d.subdir, d.name]), [['skills', 'visible'], ['vendor', 'demo']])
    assert.deepEqual(await external.discoverTraeCnSkills(root), await external.discoverSkills([root], ['skills']))
  } finally {
    await removeTree(root)
  }
})

test('discoverTraeCnSkills scans only the skills subdir and ignores builtin_skills', async () => {
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skill-a')
    // Seed builtin_skills by hand (seedTraeCnSkill only writes under skills/):
    // a valid skill there must be silently ignored — not discovered, not errored.
    const builtinDir = join(traeCnDir, 'builtin_skills', 'skill-b')
    await mkdir(builtinDir, { recursive: true })
    await writeFile(join(builtinDir, 'SKILL.md'), skillMd('skill-b'))

    const discovered = await external.discoverTraeCnSkills(traeCnDir)
    assert.equal(discovered.length, 1)
    assert.deepEqual(discovered.map((d) => d.name), ['skill-a'])
    assert.ok(discovered.every((d) => d.subdir === 'skills'))
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

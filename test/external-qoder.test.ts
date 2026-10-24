import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { removeTree } from './fs-helpers.js'
import { discoverQoder, readInstalledPlugins } from '../src/qoder.js'

/**
 * Tests for the `qoder` source layout (`src/qoder.ts`).
 *
 * The promise under test is that one `<root>`（默认 `~/.qoder`）yields:
 *   - user-level skills from `<root>/skills/<技能目录>/SKILL.md`（segment `skills`）
 *   - marketplace plugin skills from `<installPath>/<声明目录>/<技能目录>/SKILL.md`
 *     （segment = 插件名，不含 publisher）
 *   - nothing from `qoder-bundler`（随客户端下发，依赖 Qoder 宿主运行时）
 *
 * Discovery is pure: no manifest, no ~/.dsh, no symlinks. Every fixture is a
 * temporary root shaped like the real `~/.qoder`, so these tests also pin the
 * layout the docs promise.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const skillMd = (name: string): string =>
  `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody of ${name}.\n`

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** Seed `<dir>/SKILL.md` and return the skill directory. */
async function seedSkill(dir: string, name: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), skillMd(name))
  return dir
}

/** `plugin.json` at the documented location: `<installPath>/.qoder-plugin/`. */
async function declarePlugin(installPath: string, plugin: Record<string, unknown>): Promise<string> {
  await writeJson(join(installPath, '.qoder-plugin', 'plugin.json'), plugin)
  return installPath
}

/** `plugins/cache/<publisher>/<name>[/<version>]` — the two depths seen in the wild. */
async function cacheDir(root: string, publisher: string, name: string, version?: string): Promise<string> {
  const dir = version === undefined
    ? join(root, 'plugins', 'cache', publisher, name)
    : join(root, 'plugins', 'cache', publisher, name, version)
  await mkdir(dir, { recursive: true })
  return dir
}

async function writeInventory(root: string, plugins: Record<string, unknown[]>): Promise<void> {
  await writeJson(join(root, 'plugins', 'installed_plugins_v2.json'), { plugins, version: 2 })
}

const record = (installPath: unknown, enabled?: unknown): Record<string, unknown> =>
  enabled === undefined ? { installPath } : { installPath, enabled }

/** `[segment, dirName]` per discovered skill, in discovery order. */
async function summary(root: string): Promise<[string, string][]> {
  return (await discoverQoder(root)).map((d) => [d.segment, d.name])
}

/**
 * Same pairs, sorted as `segment.dirName`. Directory listings carry no order
 * guarantee across platforms (NTFS is alphabetical, ext4/APFS are hash order),
 * so any expectation spanning several entries in one directory compares sorted.
 */
async function sortedNames(root: string): Promise<string[]> {
  return (await summary(root)).map(([segment, name]) => `${segment}.${name}`).sort()
}

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nexus-qoder-'))
  try {
    await body(root)
  } finally {
    await removeTree(root)
  }
}

/* ------------------------------------------------------------------ */
/* Plugin skills                                                       */
/* ------------------------------------------------------------------ */

test('both versioned and unversioned install depths are discovered', async () => {
  await withRoot(async (root) => {
    const versioned = await cacheDir(root, 'qoder-marketplace', 'superpowers', '6.3.0')
    await declarePlugin(versioned, { name: 'superpowers', skills: './skills/' })
    await seedSkill(join(versioned, 'skills', 'brainstorming'), 'brainstorming')
    await seedSkill(join(versioned, 'skills', 'systematic-debugging'), 'systematic-debugging')

    const flat = await cacheDir(root, 'qoder-marketplace', 'qmind-knowledge')
    await declarePlugin(flat, { name: 'qmind-knowledge', skills: './skills/' })
    await seedSkill(join(flat, 'skills', 'qmind-knowledge'), 'qmind-knowledge')

    await writeInventory(root, {
      'superpowers@qoder-marketplace': [record(versioned)],
      'qmind-knowledge@qoder-marketplace': [record(flat)],
    })

    assert.deepEqual(await sortedNames(root), [
      'qmind-knowledge.qmind-knowledge',
      'superpowers.brainstorming',
      'superpowers.systematic-debugging',
    ])
  })
})

test('a skills array declares several directories, including one that is a skill itself', async () => {
  await withRoot(async (root) => {
    const plugin = await cacheDir(root, 'qoder-marketplace', 'multi')
    await declarePlugin(plugin, { name: 'multi', skills: ['./skills/', './extra/pack'] })
    await seedSkill(join(plugin, 'skills', 'alpha'), 'alpha')
    // `extra/pack` has its own SKILL.md → it *is* the skill, not a container.
    await seedSkill(join(plugin, 'extra', 'pack'), 'pack')
    await writeInventory(root, { 'multi@qoder-marketplace': [record(plugin)] })

    assert.deepEqual(await summary(root), [
      ['multi', 'alpha'],
      ['multi', 'pack'],
    ])
  })
})

test('a plugin without a skills field falls back to ./skills/, with or without plugin.json', async () => {
  await withRoot(async (root) => {
    // Declared plugin.json that omits `skills`.
    const declared = await cacheDir(root, 'qoder-marketplace', 'no-skills-field', '1.0.0')
    await declarePlugin(declared, { name: 'no-skills-field' })
    await seedSkill(join(declared, 'skills', 'fallback-alpha'), 'fallback-alpha')

    // No plugin.json at all — the `./skills/` convention still applies.
    const bare = await cacheDir(root, 'qoder-marketplace', 'no-manifest', '2.0.0')
    await seedSkill(join(bare, 'skills', 'fallback-beta'), 'fallback-beta')

    await writeInventory(root, {
      'no-skills-field@qoder-marketplace': [record(declared)],
      'no-manifest@qoder-marketplace': [record(bare)],
    })

    assert.deepEqual(await summary(root), [
      ['no-skills-field', 'fallback-alpha'],
      ['no-manifest', 'fallback-beta'],
    ])
  })
})

test('a second nesting level under the declared dir is not collected', async () => {
  await withRoot(async (root) => {
    const plugin = await cacheDir(root, 'qoder-marketplace', 'superpowers', '6.3.0')
    await declarePlugin(plugin, { name: 'superpowers', skills: './skills/' })
    await seedSkill(join(plugin, 'skills', 'ok'), 'ok')
    // Fixture-level contract guard for "one level only": a skill two levels down
    // belongs to the plugin's internal structure, not to the skill set.
    await seedSkill(join(plugin, 'skills', 'case-studies', 'demo'), 'demo')
    await writeInventory(root, { 'superpowers@qoder-marketplace': [record(plugin)] })

    assert.deepEqual(await summary(root), [['superpowers', 'ok']])
  })
})

/* ------------------------------------------------------------------ */
/* Inventory filtering                                                 */
/* ------------------------------------------------------------------ */

test('a plugin disabled in the panel is skipped', async () => {
  await withRoot(async (root) => {
    const enabled = await cacheDir(root, 'qoder-marketplace', 'enabled-plugin')
    await declarePlugin(enabled, { name: 'enabled-plugin', skills: './skills/' })
    await seedSkill(join(enabled, 'skills', 'enabled-skill'), 'enabled-skill')

    const disabled = await cacheDir(root, 'qoder-marketplace', 'disabled-plugin')
    await declarePlugin(disabled, { name: 'disabled-plugin', skills: './skills/' })
    await seedSkill(join(disabled, 'skills', 'disabled-skill'), 'disabled-skill')

    await writeInventory(root, {
      'enabled-plugin@qoder-marketplace': [record(enabled, true)],
      'disabled-plugin@qoder-marketplace': [record(disabled, false)],
    })

    assert.deepEqual(await summary(root), [['enabled-plugin', 'enabled-skill']])
  })
})

test('records without an installPath, or pointing at a missing directory, are skipped silently', async () => {
  await withRoot(async (root) => {
    const present = await cacheDir(root, 'qoder-marketplace', 'present')
    await declarePlugin(present, { name: 'present', skills: './skills/' })
    await seedSkill(join(present, 'skills', 'present-skill'), 'present-skill')

    await writeInventory(root, {
      'no-install-path@qoder-marketplace': [{ enabled: true }],
      'vanished@qoder-marketplace': [record(join(root, 'plugins', 'cache', 'gone', '0.0.0'))],
      'present@qoder-marketplace': [record(present)],
    })

    assert.deepEqual(await summary(root), [['present', 'present-skill']])
  })
})

test('every qoder-bundler plugin is excluded, computer-use included', async () => {
  await withRoot(async (root) => {
    const bundled: Record<string, unknown[]> = {}
    for (const name of ['better-harness', 'security-scan', 'qoder-create-plugin', 'staged-plan-execution', 'computer-use']) {
      const dir = await cacheDir(root, 'qoder-bundler', name)
      await declarePlugin(dir, { name, skills: './skills/' })
      await seedSkill(join(dir, 'skills', `${name}-skill`), `${name}-skill`)
      bundled[`${name}@qoder-bundler`] = [record(dir)]
    }
    // A marketplace plugin in the same inventory proves the filter is
    // publisher-specific rather than "skip everything but the first key".
    const marketplace = await cacheDir(root, 'qoder-marketplace', 'kept')
    await declarePlugin(marketplace, { name: 'kept', skills: './skills/' })
    await seedSkill(join(marketplace, 'skills', 'kept-skill'), 'kept-skill')

    await writeInventory(root, { ...bundled, 'kept@qoder-marketplace': [record(marketplace)] })

    assert.deepEqual(await summary(root), [['kept', 'kept-skill']])
    assert.deepEqual(
      (await readInstalledPlugins(root)).map((p) => [p.pluginName, p.publisher]),
      [
        ['better-harness', 'qoder-bundler'],
        ['security-scan', 'qoder-bundler'],
        ['qoder-create-plugin', 'qoder-bundler'],
        ['staged-plan-execution', 'qoder-bundler'],
        ['computer-use', 'qoder-bundler'],
        ['kept', 'qoder-marketplace'],
      ],
    )
  })
})

/* ------------------------------------------------------------------ */
/* User-level precedence                                               */
/* ------------------------------------------------------------------ */

test('a skill name seen twice keeps the user-level entry, then the first plugin', async () => {
  await withRoot(async (root) => {
    const userSkill = await seedSkill(join(root, 'skills', 'brainstorming'), 'brainstorming')
    const userOnly = await seedSkill(join(root, 'skills', 'evidence-based-engineering'), 'evidence-based-engineering')

    const first = await cacheDir(root, 'qoder-marketplace', 'superpowers', '6.3.0')
    await declarePlugin(first, { name: 'superpowers', skills: './skills/' })
    const pluginSkill = await seedSkill(join(first, 'skills', 'brainstorming'), 'brainstorming')
    await seedSkill(join(first, 'skills', 'using-git-worktrees'), 'using-git-worktrees')

    // Same skill name in a second plugin: the first plugin already claimed it.
    const second = await cacheDir(root, 'qoder-marketplace', 'duplicate')
    await declarePlugin(second, { name: 'duplicate', skills: './skills/' })
    await seedSkill(join(second, 'skills', 'using-git-worktrees'), 'using-git-worktrees')

    await writeInventory(root, {
      'superpowers@qoder-marketplace': [record(first)],
      'duplicate@qoder-marketplace': [record(second)],
    })

    const discovered = await discoverQoder(root)
    assert.equal(discovered.length, 3)
    // User-level wins over the plugin copy of the same skill name.
    const brainstorming = discovered.filter((d) => d.name === 'brainstorming')
    assert.equal(brainstorming.length, 1)
    assert.equal(brainstorming[0]!.segment, 'skills')
    assert.equal(brainstorming[0]!.dir, userSkill)
    assert.notEqual(brainstorming[0]!.dir, pluginSkill)
    // Two plugins claim `using-git-worktrees`: the first one in the inventory wins.
    const worktrees = discovered.filter((d) => d.name === 'using-git-worktrees')
    assert.equal(worktrees.length, 1)
    assert.equal(worktrees[0]!.segment, 'superpowers')
    // The user-only skill survives untouched.
    assert.equal(discovered.find((d) => d.dir === userOnly)?.segment, 'skills')
  })
})

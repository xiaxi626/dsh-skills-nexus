import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { removeTree } from './fs-helpers.js'

/**
 * Tests for the second Qoder-family source, `qoder-cn` (`src/external.ts`).
 *
 * `qoder` 与 `qoder-cn` 共用 `src/qoder.ts` 的同一个发现器，差异只在根目录。
 * 这里钉住的是注册层的契约，不是布局知识（布局由 `external-qoder.test.ts` 覆盖）：
 *   - 根解析：`QODER_CN_DIR` 生效，`--source-dir` 优先，缺失覆盖不回退
 *   - 命名：`qoder-cn.skills.<技能>` / `qoder-cn.<插件>.<技能>`，`url` 以
 *     `qoder-cn:` 开头，`groupPath[0]` 默认为 `qoder-cn`
 *   - `--group` 覆盖 L1 组名
 *   - 两个客户端根各自成条：同名技能不互相吞并
 *
 * `qoder` 自身此前没有 roots 单测；第一条用例顺带补上这类根解析空白。
 */

let home: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let external: typeof import('../src/external.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-qoder-cn-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  external = await import('../src/external.js')
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

/** `plugins/cache/<publisher>/<name>` — the unversioned install depth. */
async function cacheDir(root: string, publisher: string, name: string): Promise<string> {
  const dir = join(root, 'plugins', 'cache', publisher, name)
  await mkdir(dir, { recursive: true })
  return dir
}

async function declarePlugin(installPath: string, plugin: Record<string, unknown>): Promise<string> {
  await writeJson(join(installPath, '.qoder-plugin', 'plugin.json'), plugin)
  return installPath
}

async function writeInventory(root: string, plugins: Record<string, unknown[]>): Promise<void> {
  await writeJson(join(root, 'plugins', 'installed_plugins_v2.json'), { plugins, version: 2 })
}

const record = (installPath: unknown, enabled?: unknown): Record<string, unknown> =>
  enabled === undefined ? { installPath } : { installPath, enabled }

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nexus-qoder-cn-'))
  try {
    await body(root)
  } finally {
    await removeTree(root)
  }
}

async function clearManifest(): Promise<void> {
  for (const entry of (await manifest.readManifest()).skills) {
    await manifest.removeEntry(entry.name)
  }
}

/* ------------------------------------------------------------------ */
/* Root resolution                                                     */
/* ------------------------------------------------------------------ */

test('qoder-cn roots: QODER_CN_DIR applies, --source-dir wins, a missing override never falls back', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nexus-qoder-cn-roots-'))
  const previous = process.env.QODER_CN_DIR
  try {
    const root = join(base, 'root')
    const override = join(base, 'override')
    await mkdir(root, { recursive: true })
    await mkdir(override)

    process.env.QODER_CN_DIR = root
    assert.deepEqual(await external.resolveSourceRoots('qoder-cn'), [root])
    assert.deepEqual(await external.resolveSourceRoots('qoder-cn', { dirOverride: override }), [override])

    // 显式覆盖只检查该路径：不存在的覆盖必须报错，而不是悄悄回退到默认根。
    const missing = join(base, 'missing')
    await assert.rejects(external.resolveSourceRoots('qoder-cn', { dirOverride: missing }), (err: unknown) => {
      assert.ok(err instanceof external.LinkError)
      assert.equal(err.code, 'not-found')
      assert.ok(err.message.includes('--source-dir') && err.message.includes('QODER_CN_DIR'))
      return true
    })
  } finally {
    if (previous === undefined) delete process.env.QODER_CN_DIR
    else process.env.QODER_CN_DIR = previous
    await removeTree(base)
  }
})

/* ------------------------------------------------------------------ */
/* Naming                                                              */
/* ------------------------------------------------------------------ */

test('a CN-shaped root yields qoder-cn.skills.* and qoder-cn.<plugin>.* only, with qoder-cn: urls', async () => {
  await clearManifest()
  await withRoot(async (root) => {
    const userSkill = await seedSkill(join(root, 'skills', 'evidence-based-engineering'), 'evidence-based-engineering')

    const plugin = await cacheDir(root, 'qoder-cn-marketplace', 'qmind-knowledge')
    await declarePlugin(plugin, { name: 'qmind-knowledge', skills: './skills/' })
    const pluginSkill = await seedSkill(join(plugin, 'skills', 'qmind-knowledge'), 'qmind-knowledge')

    // 随客户端下发的插件：与 `~/.qoder-cn` 实机一致，publisher 同为 qoder-bundler。
    const bundled = await cacheDir(root, 'qoder-bundler', 'security-scan')
    await declarePlugin(bundled, { name: 'security-scan', skills: './skills/' })
    await seedSkill(join(bundled, 'skills', 'security-scan'), 'security-scan')

    await writeInventory(root, {
      'security-scan@qoder-bundler': [record(bundled, false)],
      'qmind-knowledge@qoder-cn-marketplace': [record(plugin)],
    })

    const plan = await external.planLinkLocal('qoder-cn', { dirOverride: root })
    assert.deepEqual(plan.entries.map((e) => e.name).sort(), [
      'qoder-cn.qmind-knowledge.qmind-knowledge',
      'qoder-cn.skills.evidence-based-engineering',
    ])
    assert.equal(plan.conflicts.length, 0)
    for (const entry of plan.entries) {
      assert.equal(entry.groupPath[0], 'qoder-cn', entry.name)
      assert.ok(entry.externalDir.startsWith(root), entry.name)
    }
    assert.equal(plan.entries.find((e) => e.name.endsWith('.evidence-based-engineering'))!.externalDir, userSkill)
    assert.equal(plan.entries.find((e) => e.name.endsWith('.qmind-knowledge'))!.externalDir, pluginSkill)

    // `url` 只在执行期写入 manifest，因此前缀在 linkLocal 之后核对。
    const { result } = await external.linkLocal('qoder-cn', { dirOverride: root })
    assert.equal(result.added.length, 2)
    const entries = (await manifest.readManifest()).skills
    assert.deepEqual(
      entries
        .filter((e) => e.name.startsWith('qoder-cn.'))
        .map((e) => [e.name, e.url])
        .sort(),
      [
        ['qoder-cn.qmind-knowledge.qmind-knowledge', 'qoder-cn:qmind-knowledge/qmind-knowledge'],
        ['qoder-cn.skills.evidence-based-engineering', 'qoder-cn:skills/evidence-based-engineering'],
      ],
    )
    assert.ok(entries.every((e) => e.name !== 'qoder-cn.security-scan.security-scan'), 'bundler skill must stay out')
  })
})

test('--group overrides the L1 name for qoder-cn', async () => {
  await clearManifest()
  await withRoot(async (root) => {
    await seedSkill(join(root, 'skills', 'grouped'), 'grouped')

    const plan = await external.planLinkLocal('qoder-cn', { dirOverride: root, group: 'custom-gn' })
    assert.equal(plan.entries.length, 1)
    assert.deepEqual(plan.entries[0]!.groupPath, ['custom-gn', 'skills', 'grouped'])
    assert.equal(plan.entries[0]!.name, 'custom-gn.skills.grouped')
  })
})

/* ------------------------------------------------------------------ */
/* Two clients, one skill name                                         */
/* ------------------------------------------------------------------ */

test('qoder and qoder-cn keep separate entries for a same-named skill', async () => {
  await clearManifest()
  await withRoot(async (cnRoot) => {
    await withRoot(async (globalRoot) => {
      const cnSkill = await seedSkill(join(cnRoot, 'skills', 'shared-skill'), 'shared-skill')
      const globalSkill = await seedSkill(join(globalRoot, 'skills', 'shared-skill'), 'shared-skill')

      const cnPlan = await external.planLinkLocal('qoder-cn', { dirOverride: cnRoot })
      const globalPlan = await external.planLinkLocal('qoder', { dirOverride: globalRoot })

      assert.equal(cnPlan.entries.length, 1)
      assert.equal(globalPlan.entries.length, 1)
      // 命名空间隔离：同名技能在两侧是不同的扁平名，各自指向自己的根。
      assert.equal(cnPlan.entries[0]!.name, 'qoder-cn.skills.shared-skill')
      assert.equal(globalPlan.entries[0]!.name, 'qoder.skills.shared-skill')
      assert.notEqual(cnPlan.entries[0]!.name, globalPlan.entries[0]!.name)
      assert.equal(cnPlan.entries[0]!.externalDir, cnSkill)
      assert.equal(globalPlan.entries[0]!.externalDir, globalSkill)
      assert.equal(cnPlan.conflicts.length + globalPlan.conflicts.length, 0)
    })
  })
})

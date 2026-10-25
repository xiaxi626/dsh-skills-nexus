import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTree } from './fs-helpers.js'

/**
 * Tests for the CodeBuddy / WorkBuddy sources (`src/external.ts`).
 *
 * 两个来源与两个 Trae 来源同构：只扫 `<root>/skills/` 一层，复用
 * `plainDiscovery(['skills'])`，没有自己的发现器。这里钉住的是注册层契约：
 *   - 根解析：`CODEBUDDY_DIR` / `WORKBUDDY_DIR` 生效，`--source-dir` 优先，
 *     缺失覆盖不回退
 *   - 命名：`<source>.skills.<技能>`，`url` 以 `<source>:` 开头，
 *     `groupPath[0]` 默认为来源名
 *   - `--group` 覆盖 L1 组名
 *   - 两个来源命名空间各自独立：同名技能不互相吞并
 */

const SOURCES = ['codebuddy', 'workbuddy'] as const

let home: string
let external: typeof import('../src/external.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-cb-wb-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  external = await import('../src/external.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
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

/** Seed `<dir>/SKILL.md` and return the skill directory. */
async function seedSkill(dir: string, name: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), skillMd(name))
  return dir
}

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nexus-cb-wb-'))
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

for (const source of SOURCES) {
  test(`${source} roots: own env var applies, --source-dir wins, a missing override never falls back`, async () => {
    const base = await mkdtemp(join(tmpdir(), `nexus-${source}-roots-`))
    const envVar = external.SOURCE_CONFIGS[source]!.envVar
    const previous = process.env[envVar]
    try {
      const root = join(base, 'root')
      const override = join(base, 'override')
      await mkdir(root, { recursive: true })
      await mkdir(override)

      process.env[envVar] = root
      assert.deepEqual(await external.resolveSourceRoots(source), [root])
      assert.deepEqual(await external.resolveSourceRoots(source, { dirOverride: override }), [override])

      // 显式覆盖只检查该路径：不存在的覆盖必须报错，而不是悄悄回退到默认根。
      const missing = join(base, 'missing')
      await assert.rejects(external.resolveSourceRoots(source, { dirOverride: missing }), (err: unknown) => {
        assert.ok(err instanceof external.LinkError)
        assert.equal(err.code, 'not-found')
        assert.ok(err.message.includes('--source-dir') && err.message.includes(envVar))
        return true
      })
    } finally {
      if (previous === undefined) delete process.env[envVar]
      else process.env[envVar] = previous
      await removeTree(base)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Naming and urls                                                     */
/* ------------------------------------------------------------------ */

for (const source of SOURCES) {
  test(`${source} yields ${source}.skills.<dir> for one level of skills/ only, with ${source}: urls`, async () => {
    await clearManifest()
    await withRoot(async (root) => {
      const skillDir = await seedSkill(join(root, 'skills', 'demo'), 'demo')
      await seedSkill(join(root, 'skills', '.hidden'), 'hidden')
      await mkdir(join(root, 'skills', 'no-skill'), { recursive: true })
      await writeFile(join(root, 'skills', 'notes.md'), '# notes\n')

      const plan = await external.planLinkLocal(source, { dirOverride: root })
      assert.equal(plan.entries.length, 1, `unexpected entries: ${plan.entries.map((e) => e.name).join(', ')}`)
      assert.equal(plan.conflicts.length, 0)
      const entry = plan.entries[0]!
      assert.deepEqual(entry.groupPath, [source, 'skills', 'demo'])
      assert.equal(entry.name, `${source}.skills.demo`)
      assert.equal(entry.externalDir, skillDir)

      // `url` 只在执行期写入 manifest，因此前缀在 linkLocal 之后核对。
      const { result } = await external.linkLocal(source, { dirOverride: root })
      assert.deepEqual(result.added, [`${source}.skills.demo`])
      const stored = (await manifest.readManifest()).skills.find((e) => e.name === `${source}.skills.demo`)
      assert.ok(stored, 'entry not created')
      assert.equal(stored.ownership, 'external')
      assert.equal(stored.url, `${source}:skills/demo`)
      await clearManifest()
    })
  })
}

/* ------------------------------------------------------------------ */
/* --group overrides the L1 name                                       */
/* ------------------------------------------------------------------ */

test('--group overrides the L1 name for both sources', async () => {
  await clearManifest()
  for (const source of SOURCES) {
    await withRoot(async (root) => {
      await seedSkill(join(root, 'skills', 'grouped'), 'grouped')

      const plan = await external.planLinkLocal(source, { dirOverride: root, group: 'custom-cb' })
      assert.equal(plan.entries.length, 1)
      assert.deepEqual(plan.entries[0]!.groupPath, ['custom-cb', 'skills', 'grouped'])
      assert.equal(plan.entries[0]!.name, 'custom-cb.skills.grouped')
    })
  }
})

/* ------------------------------------------------------------------ */
/* Two sources, one skill name                                         */
/* ------------------------------------------------------------------ */

test('codebuddy and workbuddy keep separate entries for a same-named skill', async () => {
  await clearManifest()
  await withRoot(async (codebuddyRoot) => {
    await withRoot(async (workbuddyRoot) => {
      const cbSkill = await seedSkill(join(codebuddyRoot, 'skills', 'shared'), 'shared')
      const wbSkill = await seedSkill(join(workbuddyRoot, 'skills', 'shared'), 'shared')

      const cbPlan = await external.planLinkLocal('codebuddy', { dirOverride: codebuddyRoot })
      const wbPlan = await external.planLinkLocal('workbuddy', { dirOverride: workbuddyRoot })

      assert.equal(cbPlan.entries.length, 1)
      assert.equal(wbPlan.entries.length, 1)
      // 命名空间隔离：同名技能在两侧是不同的扁平名，各自指向自己的根。
      assert.equal(cbPlan.entries[0]!.name, 'codebuddy.skills.shared')
      assert.equal(wbPlan.entries[0]!.name, 'workbuddy.skills.shared')
      assert.equal(cbPlan.entries[0]!.externalDir, cbSkill)
      assert.equal(wbPlan.entries[0]!.externalDir, wbSkill)
      assert.equal(cbPlan.conflicts.length + wbPlan.conflicts.length, 0)
    })
  })
})

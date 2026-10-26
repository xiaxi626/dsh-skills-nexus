import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTree } from './fs-helpers.js'

/**
 * Tests for the thirteen agent-client sources (`src/external.ts`).
 *
 * 十三个来源与两个 Trae 来源同构：只扫 `<root>/skills/` 一层，复用
 * `plainDiscovery(['skills'])`，没有自己的发现器。这里钉住注册层契约：
 *   - 根解析：各自环境变量生效，`--source-dir` 优先，缺失覆盖不回退
 *   - 命名：`<source>.skills.<技能>`，`url` 以 `<source>:` 开头，`groupPath[0]` 默认来源名
 *   - `--group` 覆盖 L1 组名
 *   - 十三来源命名空间各自独立：同名技能不互相吞并
 *   - 客户端"数据根/home 替换"变量不参与根解析
 */

const SOURCES = [
  'copilot', 'claude-code', 'pi', 'codex', 'cursor', 'shared',
  'opencode', 'gemini', 'zcode', 'openclaw', 'augment', 'kimi-code', 'windsurf',
] as const

let home: string
let external: typeof import('../src/external.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-agent-clients-home-'))
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
  const root = await mkdtemp(join(tmpdir(), 'nexus-agent-clients-'))
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

/** Restore one environment variable to a snapshot taken before the test. */
function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
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
      restoreEnv(envVar, previous)
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

test('--group overrides the L1 name for every agent client', async () => {
  await clearManifest()
  for (const source of SOURCES) {
    await withRoot(async (root) => {
      await seedSkill(join(root, 'skills', 'grouped'), 'grouped')

      const plan = await external.planLinkLocal(source, { dirOverride: root, group: 'custom-agent' })
      assert.equal(plan.entries.length, 1, source)
      assert.deepEqual(plan.entries[0]!.groupPath, ['custom-agent', 'skills', 'grouped'], source)
      assert.equal(plan.entries[0]!.name, 'custom-agent.skills.grouped', source)
    })
  }
})

/* ------------------------------------------------------------------ */
/* Default-root shapes and variables that must not be followed         */
/* ------------------------------------------------------------------ */

test('multi-segment default roots resolve under homedir', async () => {
  // pi / opencode / windsurf 的默认根是两段或三段。把 home 指向临时目录、造出该层
  // 目录之后，解析结果必须整体等于 <home>/<suffix>——否则说明有人把它写成了单段。
  const cases = [
    ['pi', '.pi/agent'],
    ['opencode', '.config/opencode'],
    ['windsurf', '.codeium/windsurf'],
  ] as const
  const base = await mkdtemp(join(tmpdir(), 'nexus-fake-home-'))
  const previousHome = process.env.HOME
  const previousProfile = process.env.USERPROFILE
  process.env.HOME = base
  process.env.USERPROFILE = base
  try {
    for (const [source, suffix] of cases) {
      const dir = join(base, ...suffix.split('/'))
      await mkdir(dir, { recursive: true })
      const envVar = external.SOURCE_CONFIGS[source]!.envVar
      const previous = process.env[envVar]
      delete process.env[envVar]
      try {
        assert.deepEqual(await external.resolveSourceRoots(source), [dir], source)
      } finally {
        restoreEnv(envVar, previous)
      }
    }
  } finally {
    restoreEnv('HOME', previousHome)
    restoreEnv('USERPROFILE', previousProfile)
    await removeTree(base)
  }
})

test('client data-root variables never become the scan root', async () => {
  // KIMI_CODE_HOME 与 GEMINI_CLI_HOME 都是"替换客户端自己的根"，不是 nexus 的根。
  // 断言：设了它们，解析结果仍是被伪造 home 下的默认根，绝不等于被设置的路径。
  const cases = [
    ['gemini', 'GEMINI_CLI_HOME', '.gemini'],
    ['kimi-code', 'KIMI_CODE_HOME', '.kimi-code'],
  ] as const
  const base = await mkdtemp(join(tmpdir(), 'nexus-foreign-root-'))
  const previousHome = process.env.HOME
  const previousProfile = process.env.USERPROFILE
  process.env.HOME = join(base, 'home')
  process.env.USERPROFILE = join(base, 'home')
  try {
    for (const [source, foreignVar, defaultDirName] of cases) {
      const ownRoot = join(base, 'home', ...defaultDirName.split('/'))
      await seedSkill(join(ownRoot, 'skills', 'x'), 'x')
      const foreignRoot = join(base, `${source}-relocated`)
      await seedSkill(join(foreignRoot, 'skills', 'x'), 'x')

      const envVar = external.SOURCE_CONFIGS[source]!.envVar
      const previousOwn = process.env[envVar]
      const previousForeign = process.env[foreignVar]
      delete process.env[envVar]
      process.env[foreignVar] = foreignRoot
      try {
        const resolved = await external.resolveSourceRoots(source)
        assert.deepEqual(resolved, [ownRoot], `${source} must scan its own default root`)
        assert.equal(resolved.includes(foreignRoot), false, `${source} followed ${foreignVar}`)
      } finally {
        restoreEnv(envVar, previousOwn)
        restoreEnv(foreignVar, previousForeign)
      }
    }
  } finally {
    restoreEnv('HOME', previousHome)
    restoreEnv('USERPROFILE', previousProfile)
    await removeTree(base)
  }
})

test('kimi-code does not pick up flat .md skills at the top level', async () => {
  // Kimi 支持 skills/commit.md 直接注册为 skill；本契约只认目录 + SKILL.md。
  // 钉成失败安全断言，避免以后被当成 bug 修。
  await clearManifest()
  await withRoot(async (root) => {
    await mkdir(join(root, 'skills'), { recursive: true })
    await writeFile(join(root, 'skills', 'commit.md'), '---\nname: commit\n---\nBody\n')
    await seedSkill(join(root, 'skills', 'review-pr'), 'review-pr')
    const plan = await external.planLinkLocal('kimi-code', { dirOverride: root })
    assert.deepEqual(plan.entries.map((e) => e.name), ['kimi-code.skills.review-pr'])
  })
})

/* ------------------------------------------------------------------ */
/* Thirteen sources, one skill name                                    */
/* ------------------------------------------------------------------ */

test('thirteen sources keep separate entries for a same-named skill', async () => {
  await clearManifest()
  for (const source of SOURCES) {
    await withRoot(async (root) => {
      const dir = await seedSkill(join(root, 'skills', 'shared-name'), 'shared-name')
      const plan = await external.planLinkLocal(source, { dirOverride: root })
      assert.equal(plan.entries.length, 1, source)
      assert.equal(plan.entries[0]!.name, `${source}.skills.shared-name`, source)
      assert.equal(plan.entries[0]!.externalDir, dir, source)
      assert.equal(plan.conflicts.length, 0, source)
    })
  }
})

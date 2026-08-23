import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillEntry } from '../src/types.js'

/**
 * resolveAll / resolveByName — the provider's list()/get() pipeline against
 * a real temp DSH_HOME with fixture clones.
 *
 * Same env-before-import constraint as manifest.test.ts: node:test's default
 * per-process isolation makes it safe.
 */

let home: string
let resolve: typeof import('../src/resolve.js')
let paths: typeof import('../src/paths.js')
let skillsDir: string

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-resolve-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  resolve = await import('../src/resolve.js')
  paths = await import('../src/paths.js')
  skillsDir = paths.SKILLS_DIR
  await mkdir(skillsDir, { recursive: true })
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

function entry(partial: Partial<SkillEntry>): SkillEntry {
  return {
    name: 'demo',
    url: 'github:owner/demo',
    gitUrl: 'https://github.com/owner/demo.git',
    ref: 'main',
    path: 'demo',
    enabled: true,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

async function writeManifest(entries: SkillEntry[]): Promise<void> {
  await writeFile(paths.MANIFEST_PATH, JSON.stringify({ version: 1, skills: entries }), 'utf8')
}

async function writeSkill(rel: string, content: string): Promise<void> {
  const p = join(skillsDir, rel)
  await mkdir(join(skillsDir, rel.split('/').slice(0, -1).join('/')), { recursive: true })
  await writeFile(p, content, 'utf8')
}

test('resolves a single-skill repo with frontmatter name/description', async () => {
  await writeManifest([entry({ name: 'demo', path: 'demo' })])
  await writeSkill('demo/SKILL.md', '---\nname: demo-skill\ndescription: A demo skill\n---\nBody text')

  const all = await resolve.resolveAll()
  assert.equal(all.length, 1)
  const s = all[0]!
  assert.equal(s.name, 'demo-skill')
  assert.equal(s.description, 'A demo skill')
  assert.equal(s.body, 'Body text')
  assert.equal(s.resourceBase, join(skillsDir, 'demo'))
  assert.equal(s.modelInvocable, true)
  assert.equal(s.userInvocable, true)
})

test('frontmatter name falls back to the entry name', async () => {
  await writeManifest([entry({ name: 'demo', path: 'demo' })])
  await writeSkill('demo/SKILL.md', '# no frontmatter')

  const all = await resolve.resolveAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.name, 'demo')
  assert.equal(all[0]!.description, 'demo') // description falls back to name
})

test('a bundled repo yields one skill per subdirectory', async () => {
  await writeManifest([entry({ name: 'bundle', path: 'bundle' })])
  await writeSkill('bundle/alpha/SKILL.md', '---\nname: alpha\n---\nA')
  await writeSkill('bundle/beta/SKILL.md', '---\nname: beta\n---\nB')

  const all = await resolve.resolveAll()
  assert.equal(all.length, 2)
  const names = all.map((s) => s.name).sort()
  assert.deepEqual(names, ['alpha', 'beta'])
  assert.deepEqual(
    all.map((s) => s.resourceBase).sort(),
    [join(skillsDir, 'bundle', 'alpha'), join(skillsDir, 'bundle', 'beta')],
  )
})

test('disabled entries are skipped', async () => {
  await writeManifest([
    entry({ name: 'on', path: 'on' }),
    entry({ name: 'off', path: 'off', enabled: false }),
  ])
  await writeSkill('on/SKILL.md', '# on')
  await writeSkill('off/SKILL.md', '# off')

  const all = await resolve.resolveAll()
  assert.deepEqual(all.map((s) => s.name), ['on'])
})

test('invocation flags are honored', async () => {
  await writeManifest([entry({ name: 'flags', path: 'flags' })])
  await writeSkill(
    'flags/SKILL.md',
    '---\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody',
  )

  const all = await resolve.resolveAll()
  assert.equal(all[0]!.modelInvocable, false)
  assert.equal(all[0]!.userInvocable, false)
})

test('non-boolean flag values fall back to defaults', async () => {
  await writeManifest([entry({ name: 'str', path: 'str' })])
  await writeSkill('str/SKILL.md', '---\nuser-invocable: "false"\n---\nbody')

  const all = await resolve.resolveAll()
  assert.equal(all[0]!.userInvocable, true) // string "false" is not a boolean
})

test('resolveByName finds the skill or returns null', async () => {
  await writeManifest([entry({ name: 'demo', path: 'demo' })])
  await writeSkill('demo/SKILL.md', '---\nname: demo-skill\n---\nBody')

  const found = await resolve.resolveByName('demo-skill')
  assert.ok(found)
  assert.equal(found!.name, 'demo-skill')
  assert.equal(await resolve.resolveByName('missing'), null)
})

test('an entry whose clone is missing yields no skills', async () => {
  await writeManifest([entry({ name: 'ghost', path: 'ghost' })])
  const all = await resolve.resolveAll()
  assert.deepEqual(all, [])
})

test('flat markdown without frontmatter name AND description is not a skill', async () => {
  await writeManifest([entry({ name: 'docsrepo', path: 'docsrepo' })])
  // A collection-repo root full of docs must not "fake-install".
  await writeSkill('docsrepo/community-leaderboard.md', '# board')
  await writeSkill('docsrepo/README.zh-CN.md', '# readme')
  await writeSkill('docsrepo/notes.md', '# notes')

  const all = await resolve.resolveAll()
  assert.deepEqual(all, [])
})

test('flat markdown with frontmatter name qualifies as a skill', async () => {
  await writeManifest([entry({ name: 'flatrepo', path: 'flatrepo' })])
  await writeSkill('flatrepo/alpha.md', '---\nname: alpha\ndescription: A\n---\nbody')
  await writeSkill('flatrepo/beta.md', '---\ndescription: only desc\n---\nbody')

  const all = await resolve.resolveAll()
  assert.deepEqual(all.map((s) => s.name).sort(), ['alpha', 'flatrepo'])
})

test('an entry with subdir resolves skills from inside that subdir', async () => {
  await writeManifest([entry({ name: 'sub', path: 'sub', subdir: 'skills/foo' })])
  await writeSkill('sub/skills/foo/SKILL.md', '---\nname: foo-skill\n---\nA')
  await writeSkill('sub/skills/bar/SKILL.md', '---\nname: bar-skill\n---\nB')

  const all = await resolve.resolveAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.name, 'foo-skill')
  assert.equal(all[0]!.resourceBase, join(skillsDir, 'sub', 'skills', 'foo'))
})

test('previewSkills applies the full skill rules to any directory', async () => {
  await writeSkill('preview/skills/real/SKILL.md', '---\nname: real\n---\nR')
  await writeSkill('preview/CONTRIBUTING.md', '# contributing')
  await writeSkill('preview/README.zh-CN.md', '# readme')
  await writeSkill('preview/doc.md', '# no frontmatter')

  // Previewing the nested subdir finds the real skill.
  const nested = await resolve.previewSkills(join(skillsDir, 'preview', 'skills', 'real'))
  assert.equal(nested.length, 1)
  assert.equal(nested[0]!.name, 'real')

  // Previewing the docs-only root finds nothing.
  const root = await resolve.previewSkills(join(skillsDir, 'preview'))
  assert.deepEqual(root, [])
})

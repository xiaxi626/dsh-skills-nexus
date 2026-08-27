import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * previewSkills / isValidSkillName — tests for the skill preview pipeline
 * and name validation against a real temp DSH_HOME.
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
  delete process.env.DSH_HOME
})

async function writeSkill(rel: string, content: string): Promise<void> {
  const p = join(skillsDir, rel)
  await mkdir(join(skillsDir, rel.split('/').slice(0, -1).join('/')), { recursive: true })
  await writeFile(p, content, 'utf8')
}

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

test('isValidSkillName accepts kebab-case and rejects PascalCase', () => {
  assert.equal(resolve.isValidSkillName('curriculum-designer'), true)
  assert.equal(resolve.isValidSkillName('curriculum_designer'), false)
  assert.equal(resolve.isValidSkillName('skill.1'), false)
  assert.equal(resolve.isValidSkillName('skill1'), true)
  assert.equal(resolve.isValidSkillName('CurriculumDesigner'), false)
  assert.equal(resolve.isValidSkillName('curriculum Designer'), false)
  assert.equal(resolve.isValidSkillName('-skill'), false)
  assert.equal(resolve.isValidSkillName(''), false)
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateSkillFiles } from '../src/locator.js'

/**
 * locateSkillFiles — the 3 discovery layouts, against real temp dirs:
 *   1. <root>/SKILL.md            -> single skill, resourceBase = root
 *   2. <root>/<name>/SKILL.md     -> bundle, resourceBase = subdir
 *   3. <root>/<name>.md           -> flat markdown, resourceBase = root
 */

let root: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-locator-'))
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

async function fixture(rel: string, content = 'body'): Promise<string> {
  const p = join(root, rel)
  await mkdir(join(root, rel.split('/').slice(0, -1).join('/')), { recursive: true })
  await writeFile(p, content, 'utf8')
  return p
}

test('root SKILL.md is authoritative for the whole repo', async () => {
  const repo = join(root, 'single')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'SKILL.md'), '# s', 'utf8')
  await mkdir(join(repo, 'sub'), { recursive: true })
  await writeFile(join(repo, 'sub', 'SKILL.md'), '# sub', 'utf8')
  await writeFile(join(repo, 'notes.md'), '# n', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.equal(found.length, 1)
  assert.equal(found[0]!.skillFile, join(repo, 'SKILL.md'))
  assert.equal(found[0]!.resourceBase, repo)
})

test('subdirectory bundles: one result per <name>/SKILL.md', async () => {
  const repo = join(root, 'bundle')
  await mkdir(join(repo, 'alpha'), { recursive: true })
  await mkdir(join(repo, 'beta'), { recursive: true })
  await writeFile(join(repo, 'alpha', 'SKILL.md'), '# a', 'utf8')
  await writeFile(join(repo, 'beta', 'SKILL.md'), '# b', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.equal(found.length, 2)
  const names = found.map((f) => f.skillFile).sort()
  assert.deepEqual(names, [join(repo, 'alpha', 'SKILL.md'), join(repo, 'beta', 'SKILL.md')])
  assert.ok(found.every((f) => f.resourceBase !== repo))
})

test('nested deep SKILL.md (two levels down) is excluded', async () => {
  const repo = join(root, 'nested')
  await mkdir(join(repo, 'a', 'b'), { recursive: true })
  await writeFile(join(repo, 'a', 'b', 'SKILL.md'), '# deep', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.deepEqual(found, [])
})

test('flat markdown files are discovered with resourceBase = root', async () => {
  const repo = join(root, 'flat')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'alpha.md'), '# a', 'utf8')
  await writeFile(join(repo, 'beta.md'), '# b', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.equal(found.length, 2)
  assert.ok(found.every((f) => f.resourceBase === repo))
})

test('README / CHANGELOG / LICENSE markdown are skipped (case-insensitive)', async () => {
  const repo = join(root, 'skipped')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'README.md'), '# readme', 'utf8')
  await writeFile(join(repo, 'Changelog.md'), '# changelog', 'utf8')
  await writeFile(join(repo, 'LICENSE.md'), '# license', 'utf8')
  await writeFile(join(repo, 'real.md'), '# real', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.equal(found.length, 1)
  assert.equal(found[0]!.skillFile, join(repo, 'real.md'))
})

test('hidden directories (e.g. .git, .github) are skipped', async () => {
  const repo = join(root, 'hidden')
  await mkdir(join(repo, '.git'), { recursive: true })
  await mkdir(join(repo, '.github'), { recursive: true })
  await writeFile(join(repo, '.git', 'SKILL.md'), '# git', 'utf8')
  await writeFile(join(repo, '.github', 'SKILL.md'), '# gh', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.deepEqual(found, [])
})

test('non-markdown files are ignored', async () => {
  const repo = join(root, 'nondocs')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'script.sh'), 'echo hi', 'utf8')
  await writeFile(join(repo, 'data.json'), '{}', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.deepEqual(found, [])
})

test('non-existent directory returns an empty list', async () => {
  const found = await locateSkillFiles(join(root, 'does-not-exist'))
  assert.deepEqual(found, [])
})

test('a file path (not a dir) returns an empty list', async () => {
  const filePath = await fixture('notadir.txt')
  const found = await locateSkillFiles(filePath)
  assert.deepEqual(found, [])
})

test('a directory named like a skill file does not count as a skill', async () => {
  const repo = join(root, 'dirnamed')
  await mkdir(join(repo, 'SKILL.md'), { recursive: true })
  await writeFile(join(repo, 'SKILL.md', 'x'), 'x', 'utf8')

  const found = await locateSkillFiles(repo)
  assert.deepEqual(found, [])
})

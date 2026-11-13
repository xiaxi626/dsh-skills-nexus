import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setProjectFilesEnabled, listProjectFiles } from '../src/project.js'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nexus-files-'))
}

async function writeSkill(root: string, rel: string, name: string): Promise<void> {
  const dir = join(root, rel, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} demo\n---\n\n# ${name}\n`)
}

test('disable moves a real directory into skills-disabled and enable moves it back', async () => {
  const root = await tempProject()
  try {
    await writeSkill(root, '.dsh/skills', 'alpha')
    assert.equal(await setProjectFilesEnabled(root, 'alpha', false), 'disabled')
    await assert.rejects(stat(join(root, '.dsh/skills/alpha')))
    assert.equal((await stat(join(root, '.dsh/skills-disabled/alpha'))).isDirectory(), true)
    assert.equal(await setProjectFilesEnabled(root, 'alpha', true), 'enabled')
    assert.equal((await stat(join(root, '.dsh/skills/alpha'))).isDirectory(), true)
    await assert.rejects(stat(join(root, '.dsh/skills-disabled/alpha')))
    assert.match(await readFile(join(root, '.dsh/skills/alpha/SKILL.md'), 'utf8'), /name: alpha/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('repeated calls report already-* instead of moving again', async () => {
  const root = await tempProject()
  try {
    await writeSkill(root, '.dsh/skills', 'beta')
    assert.equal(await setProjectFilesEnabled(root, 'beta', true), 'already-enabled')
    await setProjectFilesEnabled(root, 'beta', false)
    assert.equal(await setProjectFilesEnabled(root, 'beta', false), 'already-disabled')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a name that exists nowhere is not-found', async () => {
  const root = await tempProject()
  try {
    assert.equal(await setProjectFilesEnabled(root, 'missing', false), 'not-found')
    assert.equal(await setProjectFilesEnabled(root, 'missing', true), 'not-found')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('path traversal names are rejected before any filesystem access', async () => {
  const root = await tempProject()
  try {
    for (const name of ['..', '.', 'a/b', 'a\\b', '']) {
      assert.equal(await setProjectFilesEnabled(root, name, false), 'not-found')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('both roots carrying the same name stay independently visible', async () => {
  const root = await tempProject()
  try {
    await writeSkill(root, '.dsh/skills', 'gamma')
    await writeSkill(root, '.dsh/skills-disabled', 'gamma')
    const entries = await listProjectFiles(root)
    assert.equal(entries.length, 2)
    assert.deepEqual(entries.map((e) => e.enabled).sort(), [false, true])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moving onto an occupied other side is a collision', async () => {
  const root = await tempProject()
  try {
    await writeSkill(root, '.dsh/skills', 'delta')
    await writeSkill(root, '.dsh/skills-disabled', 'delta')
    assert.equal(await setProjectFilesEnabled(root, 'delta', false), 'collision')
    assert.equal(await setProjectFilesEnabled(root, 'delta', true), 'already-enabled')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

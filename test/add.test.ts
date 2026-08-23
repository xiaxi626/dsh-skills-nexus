import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Integration tests for the `add` command against a local `file://` repo.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the manifest→paths chain.
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

let home: string
let add: typeof import('../src/cli/commands/add.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-add-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  add = await import('../src/cli/commands/add.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

test('add registers a repo and records the resolved commit', async () => {
  const src = join(home, 'src-a')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'SKILL.md'), '# test\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'initial'])

  assert.equal(await add.add([`${fileUrl(src)}#main`]), 0)
  const m = await manifest.readManifest()
  assert.equal(m.skills.length, 1)
  assert.match(m.skills[0]!.commit!, /^[0-9a-f]{40}$/)
})

test('re-adding a registered repo refuses without touching the existing clone', async () => {
  const src = join(home, 'src-b')
  await mkdir(src, { recursive: true })
  await git(src, ['init'])
  await git(src, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(src, ['config', 'user.email', 'test@example.com'])
  await git(src, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(src, 'SKILL.md'), '# test\n', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'initial'])
  const url = `${fileUrl(src)}#main`

  assert.equal(await add.add([url]), 0)
  const m1 = await manifest.readManifest()
  const dest = paths.skillDir(m1.skills[0]!.path)
  await stat(dest) // clone exists

  // Re-adding the same repo must refuse and leave everything intact.
  assert.equal(await add.add([url]), 1)
  const m2 = await manifest.readManifest()
  assert.equal(m2.skills.filter((s) => s.name === 'src-b').length, 1)
  await stat(dest) // clone still exists
})

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { cloneRepo, getHeadCommit, getCurrentBranch } from '../src/git.js'
import type { OpsIO } from '../src/ops-io.js'

const execFileAsync = promisify(execFile)
const io: OpsIO = { emit() {}, error() {}, progress() {}, confirm: async () => false, interactive: false }
let home: string
let paths: typeof import('../src/paths.js')
let manifest: typeof import('../src/manifest.js')
let links: typeof import('../src/link.js')
let state: typeof import('../src/version-state.js')
let update: typeof import('../src/update.js')
let switching: typeof import('../src/switch-version.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-recovery-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  paths = await import('../src/paths.js')
  manifest = await import('../src/manifest.js')
  links = await import('../src/link.js')
  state = await import('../src/version-state.js')
  update = await import('../src/update.js')
  switching = await import('../src/switch-version.js')
})
after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, env: {
    ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  } })).stdout.trim()
}
async function fixture(name: string, detached = false) {
  const src = join(home, `src-${name}`)
  await mkdir(src)
  await git(src, ['init', '-b', 'main'])
  await writeFile(join(src, 'SKILL.md'), '---\nname: Invalid_Name\n---\n# old\n')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'old'])
  await git(src, ['tag', 'v1'])
  const before = await getHeadCommit(src)
  const url = pathToFileURL(src).href
  const ref = detached ? 'v1' : 'main'
  const dest = paths.repoDir(name)
  await cloneRepo({ url, ref, raw: url }, dest)
  const entry = { name, path: name, ref, gitUrl: url, url, commit: before, addedAt: '2026-01-01', updatedAt: '2026-01-02' }
  await manifest.addEntry(entry)
  await state.normalizeCheckout(entry)
  await links.linkSkill(`${name}-alias`, dest)
  const snapshot = await state.captureVersionState(entry)
  await writeFile(join(src, 'SKILL.md'), '---\nname: new-name\ndescription: new\n---\n# new\n')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'new'])
  return { src, dest, before, snapshot, entry }
}

for (const operation of ['update', 'switch'] as const) {
  for (const detached of [false, true]) {
    test(`${operation} 晚期 manifest 失败恢复 ${detached ? 'detached' : 'branch'}、归一化、别名和元数据`, async () => {
      const name = `late-${operation}-${detached ? 'pin' : 'branch'}`
      const f = await fixture(name, detached)
      // 真实磁盘故障发生在 checkout/归一化/重建链接之后；临时目录由 writer 的失败清理移除。
      await mkdir(`${paths.MANIFEST_PATH}.tmp`)
      await assert.rejects(operation === 'update'
        ? update.updateEntry(name, io)
        : switching.switchVersion(name, 'main', undefined, io), /EISDIR|EPERM|EACCES/)
      assert.equal(await getHeadCommit(f.dest), f.before)
      assert.equal(await getCurrentBranch(f.dest), detached ? undefined : 'main')
      assert.deepEqual(manifest.findEntry(await manifest.readManifest(), name), f.entry)
      assert.deepEqual(await links.entryLinks(f.entry), f.snapshot.links)
      const text = await readFile(join(f.dest, 'SKILL.md'), 'utf8')
      assert.match(text, /name: invalid-name/)
      assert.match(text, /description:/)
      assert.match(text, /# old/)
      if (!detached) {
        assert.equal(await git(f.dest, ['rev-parse', 'refs/heads/main']), f.before)
        assert.equal(await git(f.dest, ['rev-parse', '--abbrev-ref', 'main@{u}']), 'origin/main')
      }
    })
  }
}

test('update 在 manifest 写入后失败仍恢复原字段和 checkout', async () => {
  const f = await fixture('after-write')
  const original = new Error('late output failure')
  await assert.rejects(update.updateEntry(f.entry.name, {
    ...io,
    emit(line) { if (line.includes('✓')) throw original },
  }), (error) => error === original)
  assert.deepEqual(await state.captureVersionState(f.entry), f.snapshot)
  assert.deepEqual(manifest.findEntry(await manifest.readManifest(), f.entry.name), f.entry)
})

test('恢复失败附带诊断和 cause，不覆盖原始异常', async () => {
  const f = await fixture('recovery-diagnostic')
  await manifest.removeEntry(f.entry.name)
  const original = new Error('original operation failure')
  await assert.rejects(state.recoverVersionFailure(f.snapshot, original), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.cause, original)
    assert.match(error.message, /^original operation failure/)
    assert.match(error.message, /Recovery failed: manifest:/)
    return true
  })
  assert.equal(await getHeadCommit(f.dest), f.before)
  assert.match(await readFile(join(f.dest, 'SKILL.md'), 'utf8'), /description:/)
})

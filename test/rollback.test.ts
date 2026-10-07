import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { cloneRepo, discardLocalChanges, getHeadCommit, getCurrentBranch, rollbackAnchors } from '../src/git.js'
import type { OpsIO } from '../src/ops-io.js'
import type { SkillEntry } from '../src/types.js'
import type { RollbackJsonReport } from '../src/cli/json-types.js'

const execFileAsync = promisify(execFile)
const io: OpsIO = { emit() {}, error() {}, progress() {}, confirm: async () => false, interactive: false }
let home: string
let paths: typeof import('../src/paths.js')
let manifest: typeof import('../src/manifest.js')
let links: typeof import('../src/link.js')
let state: typeof import('../src/version-state.js')
let update: typeof import('../src/update.js')
let switching: typeof import('../src/switch-version.js')
let recovery: typeof import('../src/rollback.js')
let cli: typeof import('../src/cli/commands/rollback.js')
let locks: typeof import('../src/locks.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-rollback-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  paths = await import('../src/paths.js')
  manifest = await import('../src/manifest.js')
  links = await import('../src/link.js')
  state = await import('../src/version-state.js')
  update = await import('../src/update.js')
  switching = await import('../src/switch-version.js')
  recovery = await import('../src/rollback.js')
  cli = await import('../src/cli/commands/rollback.js')
  locks = await import('../src/locks.js')
  assert.ok(paths.REPOS_DIR.startsWith(home))
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
async function advance(src: string, label: string): Promise<string> {
  await writeFile(join(src, 'SKILL.md'), `---\nname: new-name\ndescription: new\n---\n# ${label}\n`)
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', label])
  return getHeadCommit(src)
}
async function current(name: string) {
  const entry = manifest.findEntry(await manifest.readManifest(), name)
  assert.ok(entry)
  return state.captureVersionState(entry)
}
async function fixture(name: string, options: { locked?: boolean; disabled?: boolean } = {}) {
  const src = join(home, `src-${name}`)
  await mkdir(src)
  await git(src, ['init', '-b', 'main'])
  await writeFile(join(src, 'SKILL.md'), '---\nname: Invalid_Name\n---\n# old\n')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'old'])
  await git(src, ['tag', 'v1'])
  const before = await getHeadCommit(src)
  const url = pathToFileURL(src).href
  const dest = paths.repoDir(name)
  await cloneRepo({ url, ref: options.locked ? 'v1' : 'main', raw: url }, dest)
  const entry: SkillEntry = {
    name, path: name, ref: 'main', gitUrl: url, url, commit: before,
    addedAt: '2026-01-01', updatedAt: '2026-01-02',
    ...(options.locked ? { locked: true } : {}),
  }
  await manifest.addEntry(entry)
  await state.normalizeCheckout(entry)
  if (!options.disabled) await links.linkSkill(`${name}-alias`, dest)
  const snapshot = await current(name)
  const after = await advance(src, 'new')
  await git(src, ['tag', 'v2'])
  return { src, dest, before, after, snapshot, entry, name }
}
function output() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { ...io, emit: (s: string) => { out.push(s) }, error: (s: string) => { err.push(s) } } }
}

for (const disabled of [false, true]) {
  test(`branch rollback 精确重置、归一化、元数据和${disabled ? '禁用' : '别名链接'}，消费且无 redo`, async () => {
    const f = await fixture(`branch-${disabled ? 'off' : 'on'}`, { disabled })
    await update.updateEntry(f.name, io)
    const point = await recovery.readRollbackPoint((await current(f.name)).entry)
    assert.ok(point)
    assert.equal(point.from.commit, f.before)
    assert.equal(point.to.commit, f.after)
    assert.equal(point.from.headType, 'branch')
    assert.equal(point.from.branch, 'main')
    assert.equal(point.from.enabled, !disabled)
    assert.equal(point.from.locked, false)
    assert.match(point.anchorRef, /^refs\/nexus\/rollback\/[a-f0-9]{32}$/)
    await writeFile(join(f.dest, 'local.txt'), 'discard me')
    const captured = output()
    const result = await recovery.rollbackEntry(f.name, captured.io)
    assert.equal(result.fromCommit, f.after)
    assert.equal(result.toCommit, f.before)
    assert.equal(result.wasDirty, true)
    assert.match(captured.out.join(''), /discarding local changes/)
    assert.deepEqual(await current(f.name), f.snapshot)
    assert.equal(await git(f.dest, ['rev-parse', 'refs/heads/main']), f.before)
    assert.equal(await git(f.dest, ['rev-parse', 'origin/main']), f.after)
    assert.equal(await git(f.dest, ['rev-parse', '--abbrev-ref', 'main@{u}']), 'origin/main')
    assert.equal(await git(f.dest, ['rev-parse', '--is-shallow-repository']), 'true')
    assert.match(await readFile(join(f.dest, 'SKILL.md'), 'utf8'), /name: invalid-name\r?\ndescription:/)
    await assert.rejects(readFile(join(f.dest, 'local.txt')), { code: 'ENOENT' })
    assert.equal(await recovery.readRollbackPoint(f.entry), undefined)
    assert.deepEqual(await rollbackAnchors(f.dest), [])
    await assert.rejects(recovery.rollbackEntry(f.name, io), /No rollback point/)
  })
}

test('locked → switch-version → rollback 恢复锁定及 detached 精确旧 commit', async () => {
  const f = await fixture('locked-switch', { locked: true })
  await switching.switchVersion(f.name, 'main', 'branch', io)
  const next = await current(f.name)
  assert.equal(next.entry.locked, false)
  assert.equal(next.branch, 'main')
  const point = await recovery.readRollbackPoint(next.entry)
  assert.equal(point?.from.locked, true)
  assert.equal(point?.to.locked, false)
  await recovery.rollbackEntry(f.name, io)
  assert.deepEqual(await current(f.name), f.snapshot)
})

test('shallow clone 的旧 detached 对象经过 GC 仍由唯一 anchor 保留', async () => {
  const f = await fixture('anchor-gc', { locked: true })
  await switching.switchVersion(f.name, 'main', 'branch', io)
  await git(f.dest, ['tag', '-d', 'v1'])
  await git(f.dest, ['reflog', 'expire', '--expire=now', '--all'])
  await git(f.dest, ['gc', '--prune=now'])
  assert.equal(await git(f.dest, ['rev-parse', '--is-shallow-repository']), 'true')
  const point = await recovery.readRollbackPoint((await current(f.name)).entry)
  assert.equal(point?.from.commit, f.before)
  await recovery.rollbackEntry(f.name, io)
  assert.deepEqual(await current(f.name), f.snapshot)
})

test('同 commit 的 HEAD 类型、ref 或 locked 改变也产生恢复点', async () => {
  const f = await fixture('identity-only', { locked: true })
  await switching.switchVersion(f.name, 'v1', 'tag', io)
  const point = await recovery.readRollbackPoint((await current(f.name)).entry)
  assert.ok(point)
  assert.equal(point.from.commit, point.to.commit)
  assert.equal(point.from.ref, 'main')
  assert.equal(point.to.ref, 'v1')
  assert.equal(point.from.locked, true)
  assert.equal(point.to.locked, false)
  await recovery.rollbackEntry(f.name, io)
  assert.deepEqual(await current(f.name), f.snapshot)
})

test('branch no-op 与 switch no-op 保留原恢复点；updatedAt 漂移允许恢复', async () => {
  const f = await fixture('no-op')
  await update.updateEntry(f.name, io)
  const path = recovery.rollbackPath(f.name)
  const saved = await readFile(path, 'utf8')
  assert.equal((await update.updateEntry(f.name, io)).status, 'up-to-date')
  await switching.switchVersion(f.name, 'main', 'branch', io)
  assert.equal(await readFile(path, 'utf8'), saved)
  await state.restoreEntry({ ...(await current(f.name)).entry, updatedAt: '2099-01-01' })
  await recovery.rollbackEntry(f.name, io)
  assert.deepEqual(await current(f.name), f.snapshot)
})

for (const pin of ['tag', 'sha', 'locked'] as const) {
  for (const attached of [false, true]) {
    test(`${pin} ${attached ? 'branch' : 'detached'} 漂移纠偏及普通校验不覆盖恢复点`, async () => {
      const f = await fixture(`pin-${pin}-${attached ? 'branch' : 'detached'}`)
      await switching.switchVersion(f.name, pin === 'sha' ? f.before : 'v1', undefined, io)
      if (pin === 'locked') await state.restoreEntry({ ...(await current(f.name)).entry, ref: 'main', locked: true })
      const path = recovery.rollbackPath(f.name)
      const saved = await readFile(path, 'utf8')
      assert.equal((await update.updateEntry(f.name, io)).status, 'pinned')
      await discardLocalChanges(f.dest)
      await git(f.dest, ['fetch', '--depth', '1', 'origin', 'main'])
      await git(f.dest, attached ? ['checkout', '-B', 'drift', f.after] : ['checkout', '--detach', f.after])
      const result = await update.updateEntry(f.name, io)
      assert.equal(result.status, 'updated')
      assert.equal(await getHeadCommit(f.dest), f.before)
      assert.equal(await getCurrentBranch(f.dest), undefined)
      assert.equal(await readFile(path, 'utf8'), saved)
      assert.equal((await current(f.name)).entry.locked ?? false, pin === 'locked')
    })
  }
}

for (const change of ['commit', 'head-type', 'branch', 'ref', 'manifest-commit', 'locked', 'links', 'source'] as const) {
  test(`rollback 拒绝 ${change} 漂移且不丢弃 dirty`, async () => {
    const f = await fixture(`drift-${change}`)
    await update.updateEntry(f.name, io)
    const path = recovery.rollbackPath(f.name)
    const saved = await readFile(path, 'utf8')
    const entry = (await current(f.name)).entry
    if (change === 'commit') await git(f.dest, ['reset', '--hard', f.before])
    if (change === 'head-type') await git(f.dest, ['checkout', '--detach', f.after])
    if (change === 'branch') await git(f.dest, ['checkout', '-b', 'other'])
    if (change === 'ref') await state.restoreEntry({ ...entry, ref: 'other' })
    if (change === 'manifest-commit') await state.restoreEntry({ ...entry, commit: f.before })
    if (change === 'locked') await state.restoreEntry({ ...entry, locked: true })
    if (change === 'links') await links.unlinkSkill(f.name)
    if (change === 'source') await state.restoreEntry({ ...entry, gitUrl: 'file:///other' })
    await writeFile(join(f.dest, 'dirty.txt'), 'keep me')
    const before = await current(f.name)
    await assert.rejects(recovery.rollbackEntry(f.name, io), /drifted|identity/)
    assert.equal(await readFile(join(f.dest, 'dirty.txt'), 'utf8'), 'keep me')
    assert.deepEqual(await current(f.name), before)
    assert.equal(await readFile(path, 'utf8'), saved)
  })
}

test('恢复旧别名与其他 entry/用户文件碰撞时拒绝，不覆盖他人数据', async () => {
  const f = await fixture('alias-collision')
  await update.updateEntry(f.name, io)
  const aliasPath = paths.skillLinkPath(`${f.name}-alias`)
  await writeFile(aliasPath, 'unrelated file')
  await assert.rejects(recovery.rollbackEntry(f.name, io), /link collision/)
  assert.equal(await readFile(aliasPath, 'utf8'), 'unrelated file')
  assert.equal(await getHeadCommit(f.dest), f.after)
})

for (const damage of ['mismatch', 'missing', 'invalid-ref', 'invalid-json', 'unsafe-link'] as const) {
  test(`恢复点 ${damage} 在 dirty 丢弃前拒绝`, async () => {
    const f = await fixture(`invalid-${damage}`)
    await update.updateEntry(f.name, io)
    const path = recovery.rollbackPath(f.name)
    const point = await recovery.readRollbackPoint((await current(f.name)).entry)
    assert.ok(point)
    if (damage === 'mismatch') await git(f.dest, ['update-ref', point.anchorRef, f.after])
    if (damage === 'missing') await git(f.dest, ['update-ref', '-d', point.anchorRef])
    if (damage === 'invalid-ref') point.anchorRef = '--unsafe'
    if (damage === 'unsafe-link') point.from.links[0]!.target = home
    if (damage === 'invalid-ref' || damage === 'unsafe-link') await writeFile(path, JSON.stringify(point))
    if (damage === 'invalid-json') await writeFile(path, '{')
    await writeFile(join(f.dest, 'dirty.txt'), 'keep')
    await assert.rejects(recovery.rollbackEntry(f.name, io))
    assert.equal(await getHeadCommit(f.dest), f.after)
    assert.equal(await readFile(join(f.dest, 'dirty.txt'), 'utf8'), 'keep')
  })
}

for (const failure of ['write', 'rename'] as const) {
  test(`恢复记录 ${failure} 中断只留下孤立 anchor，下次成功发布清理`, async () => {
    const f = await fixture(`interrupted-${failure}`)
    await update.updateEntry(f.name, io)
    const path = recovery.rollbackPath(f.name)
    const saved = await readFile(path, 'utf8')
    const old = await recovery.readRollbackPoint((await current(f.name)).entry)
    assert.ok(old)
    const next = await current(f.name)
    const error = new Error(`injected ${failure}`)
    await assert.rejects(recovery.saveRollbackPoint(next, next, {
      writeFile: failure === 'write' ? async () => { throw error } : writeFile,
      rename: failure === 'rename' ? async () => { throw error } : rename,
    }), (err) => err === error)
    assert.equal(await readFile(path, 'utf8'), saved)
    assert.equal((await recovery.readRollbackPoint(next.entry))?.anchorRef, old.anchorRef)
    assert.equal((await rollbackAnchors(f.dest)).length, 2)
    assert.equal((await readdir(join(paths.NEXUS_HOME, 'rollback'))).some((p) => p.startsWith(`${f.name}.json.`)), false)
    await recovery.saveRollbackPoint(next, next)
    const replaced = await recovery.readRollbackPoint(next.entry)
    assert.ok(replaced)
    assert.notEqual(replaced.anchorRef, old.anchorRef)
    assert.deepEqual(await rollbackAnchors(f.dest), [replaced.anchorRef])
  })
}

test('update 已发布恢复点后输出失败，原 checkout、manifest、链接及原恢复点完全恢复', async () => {
  const f = await fixture('published-failure')
  await update.updateEntry(f.name, io)
  const prior = await current(f.name)
  const path = recovery.rollbackPath(f.name)
  const saved = await readFile(path, 'utf8')
  await advance(f.src, 'third')
  const error = new Error('output failure')
  await assert.rejects(update.updateEntry(f.name, { ...io, emit(line) { if (line.includes('✓')) throw error } }), (err) => err === error)
  assert.deepEqual(await current(f.name), prior)
  assert.equal(await readFile(path, 'utf8'), saved)
  assert.equal((await recovery.readRollbackPoint(prior.entry))?.from.commit, f.before)
  await recovery.rollbackEntry(f.name, io)
  assert.deepEqual(await current(f.name), f.snapshot)
})

for (const operation of ['update', 'switch'] as const) {
  test(`${operation} 保存恢复点失败时闭环恢复，不输出成功摘要`, async () => {
    const f = await fixture(`save-failure-${operation}`)
    // 真实文件系统故障在 manifest 已更新后才会触发。
    await mkdir(recovery.rollbackPath(f.name), { recursive: true })
    const captured = output()
    await assert.rejects(operation === 'update' ? update.updateEntry(f.name, captured.io) : switching.switchVersion(f.name, 'v2', 'tag', captured.io))
    assert.deepEqual(await current(f.name), f.snapshot)
    assert.doesNotMatch(captured.out.join(''), /✓/)
    await rm(recovery.rollbackPath(f.name), { recursive: true })
  })
}

test('rollback manifest 晚期失败恢复到 to，保留恢复点供重试', async () => {
  const f = await fixture('rollback-late')
  await switching.switchVersion(f.name, 'v2', 'tag', io)
  const prior = await current(f.name)
  const path = recovery.rollbackPath(f.name)
  const saved = await readFile(path, 'utf8')
  await mkdir(`${paths.MANIFEST_PATH}.tmp`)
  await assert.rejects(recovery.rollbackEntry(f.name, io), /Rollback failed: manifest/)
  assert.deepEqual(await current(f.name), prior)
  assert.equal(await readFile(path, 'utf8'), saved)
  await recovery.rollbackEntry(f.name, io)
  assert.deepEqual(await current(f.name), f.snapshot)
})

test('rollback CLI JSON 使用真实回滚方向、无混杂人类 stdout，并报告消费提示', async () => {
  const f = await fixture('cli-json')
  await switching.switchVersion(f.name, 'v2', 'tag', io)
  const captured = output()
  assert.equal(await cli.rollback([f.name, '--json'], captured.io), 0)
  const report = JSON.parse(captured.out.join('')) as RollbackJsonReport
  assert.equal(report.version, 1)
  assert.equal(report.results.length, 1)
  assert.equal(report.results[0]?.status, 'rolled-back')
  assert.equal(report.results[0]?.fromCommit, f.after)
  assert.equal(report.results[0]?.toCommit, f.before)
  assert.equal(report.results[0]?.fromRef, 'v2')
  assert.equal(report.results[0]?.toRef, 'main')
  assert.equal(report.results[0]?.message, recovery.ROLLBACK_CONSUMED_MESSAGE)
  assert.deepEqual(captured.err, [])
  const again = output()
  assert.equal(await cli.rollback([f.name, '--json'], again.io), 1)
  const failed = JSON.parse(again.out.join('')) as RollbackJsonReport
  assert.equal(failed.results[0]?.status, 'failed')
  assert.equal(failed.results[0]?.fromCommit, null)
})

test('rollback CLI 人类消费提示、失败 JSON 方向与 per-entry 锁', async () => {
  const f = await fixture('cli-lock')
  await update.updateEntry(f.name, io)
  const lock = await locks.acquireSkillFileLock(f.name)
  const captured = output()
  try { assert.equal(await cli.rollback([f.name, '--json'], captured.io), 1) } finally { await lock.release() }
  assert.equal(await getHeadCommit(f.dest), f.after)
  await state.restoreEntry({ ...(await current(f.name)).entry, locked: true })
  const drift = output()
  assert.equal(await cli.rollback([f.name, '--json'], drift.io), 1)
  const failed = (JSON.parse(drift.out.join('')) as RollbackJsonReport).results[0]!
  assert.equal(failed.status, 'failed')
  assert.equal(failed.fromCommit, f.after)
  assert.equal(failed.toCommit, f.before)
  await state.restoreEntry({ ...(await current(f.name)).entry, locked: false })
  const human = output()
  assert.equal(await cli.rollback([f.name], human.io), 0)
  assert.ok(human.out.join('').includes(recovery.ROLLBACK_CONSUMED_MESSAGE))
})

test('rollback 参数仅单 entry；JSON 用法错误走 stderr；拒绝无 source', async () => {
  assert.deepEqual(cli.parseRollbackArgs(['--json', 'one']), { name: 'one', json: true })
  for (const argv of [[], ['a', 'b'], ['a', '--yes'], ['a', '--json=true']]) {
    const captured = output()
    assert.equal(await cli.rollback([...argv, '--json'], captured.io), 2)
    assert.deepEqual(captured.out, [])
    assert.equal(JSON.parse(captured.err.join('')).version, 1)
  }
  await assert.rejects(recovery.rollbackEntry('missing', io), /No skill/)
  const f = await fixture('source-less')
  await state.restoreEntry({ ...f.entry, gitUrl: '' })
  await assert.rejects(recovery.rollbackEntry(f.name, io), /no git source/)
})

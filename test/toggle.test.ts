import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Integration tests for enable/disable (`toggle`) against multi-skill repos.
 *
 * Regression: state was looked up by symlink *name* (`isLinked(entry.name)`),
 * but multi-skill repos create one symlink per skill (named by frontmatter),
 * so such entries were reported disabled — `disable` silently no-oped and
 * bare `update` skipped them. State is now resolved by link target
 * (`isEntryEnabled`).
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the manifest→paths chain (same pattern as
 * test/add.test.ts).
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

let home: string
let add: typeof import('../src/cli/commands/add.js')
let toggle: typeof import('../src/cli/commands/toggle.js')
let list: typeof import('../src/cli/commands/list.js')
let update: typeof import('../src/cli/commands/update.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-toggle-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  add = await import('../src/cli/commands/add.js')
  toggle = await import('../src/cli/commands/toggle.js')
  list = await import('../src/cli/commands/list.js')
  update = await import('../src/cli/commands/update.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** Create a repo that yields one flat `<name>.md` skill per given name. */
async function makeMultiSkillRepo(dir: string, names: string[] = ['one', 'two', 'three']): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  for (const n of names) {
    await writeFile(join(dir, `skill-${n}.md`), `---\nname: skill-${n}\n---\nS`, 'utf8')
  }
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'multi'])
}

test('multi-skill entry: disable removes all skill links, enable restores them', async () => {
  const src = join(home, 'src-multi')
  await makeMultiSkillRepo(src)

  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  const m = await manifest.readManifest()
  const entry = m.skills.find((s) => s.path.startsWith('src-multi'))!
  assert.equal(entry.name, 'src-multi')

  // Links are named after each skill's frontmatter, never after the entry.
  for (const n of ['one', 'two', 'three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }
  assert.equal(await exists(paths.skillLinkPath('src-multi')), false)
  assert.equal(await link.isEntryEnabled(entry), true)

  // Regression: disable must actually remove the links (it used to print
  // "already disabled" and no-op because no link carried the entry name).
  assert.equal(await toggle.toggle(['src-multi'], false), 0)
  for (const n of ['one', 'two', 'three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), false)
  }
  assert.equal(await link.isEntryEnabled(entry), false)

  // Disabling twice is the only case that may short-circuit.
  assert.equal(await toggle.toggle(['src-multi'], false), 0)

  // Enable restores every link.
  assert.equal(await toggle.toggle(['src-multi'], true), 0)
  for (const n of ['one', 'two', 'three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }
  assert.equal(await link.isEntryEnabled(entry), true)
})

test('multi-skill entry is included in the bare update default targets', async () => {
  const m = await manifest.readManifest()
  const entry = m.skills.find((s) => s.path.startsWith('src-multi'))!
  const beforeCommit = entry.commit

  // No upstream movement — the point is that the entry is picked up at all:
  // before the fix, the `isLinked(entry.name)` filter skipped it entirely.
  assert.equal(await update.update([]), 0)

  const m2 = await manifest.readManifest()
  const updated = m2.skills.find((s) => s.name === 'src-multi')!
  assert.equal(updated.commit, beforeCommit) // same commit (nothing upstream)
  assert.ok(updated.updatedAt, 'updatedAt re-stamped — entry was processed')

  // A disabled entry must be skipped by bare update again.
  assert.equal(await toggle.toggle(['src-multi'], false), 0)
  const m3 = await manifest.readManifest()
  const stamp = m3.skills.find((s) => s.name === 'src-multi')!.updatedAt
  assert.equal(await update.update([]), 0)
  const m4 = await manifest.readManifest()
  assert.equal(m4.skills.find((s) => s.name === 'src-multi')!.updatedAt, stamp)
  await toggle.toggle(['src-multi'], true)
})

test('list reports a multi-skill entry as on while its links exist', async () => {
  // Capture through the OpsIO seam instead of replacing process.stdout.write.
  // Replacing/restoring the stream inside a test body makes node:test (in
  // child-process mode) drop the immediately preceding test from TAP
  // registration: its body still runs, but a failure surfaces only as a
  // file-level 'test failed' with no test name or assertion message. Same
  // capture pattern as test/adopt.test.ts / test/export.test.ts.
  const lines: string[] = []
  const io: OpsIO = {
    confirm: async () => true,
    progress: () => {},
    emit: (line: string) => {
      lines.push(line)
    },
    error: () => {},
    interactive: false,
  }
  assert.equal(await list.list([], io), 0)
  const output = lines.join('')
  const row = output.split('\n').find((l) => l.includes('src-multi'))
  assert.ok(row, 'list shows the src-multi row')
  assert.match(row!, /^on\s/)
})

// §6.4 target attribution: disable removes links by readlink ownership, not
// by the name rule. The three cases below are the boundary scenarios where
// the old name-based implementation behaved differently.

test('disable removes a manually renamed alias link by target attribution', async () => {
  const src = join(home, 'src-alias')
  // Distinct skill names: linkSkill replaces same-named links, so reusing
  // one/two/three here would silently hijack the first test's links.
  await makeMultiSkillRepo(src, ['a-one', 'a-two', 'a-three'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  const m = await manifest.readManifest()
  const entry = m.skills.find((s) => s.path.startsWith('src-alias'))!

  // Simulate a user renaming a link by hand: drop skill-a-one, re-create the
  // link under a name no discovery rule would ever produce.
  await link.unlinkSkill('skill-a-one')
  await symlink(paths.repoDir(entry.path), paths.skillLinkPath('alias-one'), 'junction')
  assert.equal(await link.isEntryEnabled(entry), true)

  // Attribution disable: the alias dies with the regular links. The old
  // name-based unlink left it behind (and isEntryEnabled stayed true).
  assert.equal(await toggle.toggle(['src-alias'], false), 0)
  assert.equal(await exists(paths.skillLinkPath('alias-one')), false)
  for (const n of ['a-two', 'a-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), false)
  }
  assert.equal(await link.isEntryEnabled(entry), false)
})

test('disable cleans up remaining links even when the clone is gone', async () => {
  const src = join(home, 'src-gone')
  await makeMultiSkillRepo(src, ['g-one', 'g-two', 'g-three'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  const m = await manifest.readManifest()
  const entry = m.skills.find((s) => s.path.startsWith('src-gone'))!
  for (const n of ['g-one', 'g-two', 'g-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }

  // The clone disappears (disk cleanup, user error) while the links stay.
  await rm(paths.repoDir(entry.path), { recursive: true, force: true })

  // The old name-based disable re-discovered skills from the clone here and
  // silently removed 0 links while reporting success. Attribution needs no
  // clone — the links still go away.
  assert.equal(await toggle.toggle(['src-gone'], false), 0)
  for (const n of ['g-one', 'g-two', 'g-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), false)
  }
  assert.equal(await link.isEntryEnabled(entry), false)
})

test("disable leaves another entry's links untouched", async () => {
  const src = join(home, 'src-other')
  await makeMultiSkillRepo(src, ['alpha'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  // Single-skill repo: the link carries the entry name.
  assert.equal(await exists(paths.skillLinkPath('src-other')), true)

  assert.equal(await toggle.toggle(['src-other'], false), 0)
  assert.equal(await exists(paths.skillLinkPath('src-other')), false)
  // The first test's entry keeps all of its links — attribution never
  // crosses clone boundaries.
  for (const n of ['one', 'two', 'three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }
})

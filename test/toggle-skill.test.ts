import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OpsIO } from '../src/ops-io.js'
import { removeTree } from './fs-helpers.js'

/**
 * Per-skill enable/disable (`enable|disable <entry> --skill <name>`, issue
 * #25): one skill of a multi-skill entry can be excluded without disabling
 * the whole entry, and the exclusion is *intent* recorded on the manifest
 * entry — orthogonal to the link-derived enabled state. Whole-entry enable,
 * `update` and `switch-version` rebuilds must never resurrect an excluded
 * skill; `enable --skill` lifts the exclusion.
 *
 * Same isolation pattern as test/toggle.test.ts: `paths.ts` reads DSH_HOME at
 * import time, so the env var must be set before the first import of the
 * manifest→paths chain. Skill names are unique per fixture repo because
 * linkSkill replaces same-named links across entries.
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

/** Capture through the OpsIO seam (same pattern as test/toggle.test.ts). */
function captureIO(): { io: OpsIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      confirm: async () => true,
      progress: () => {},
      emit: (line: string) => {
        out.push(line)
      },
      error: (line: string) => {
        err.push(line)
      },
      interactive: false,
    },
  }
}

let home: string
let add: typeof import('../src/cli/commands/add.js')
let toggle: typeof import('../src/cli/commands/toggle.js')
let update: typeof import('../src/cli/commands/update.js')
let switchVersion: typeof import('../src/cli/commands/switch-version.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-toggle-skill-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  add = await import('../src/cli/commands/add.js')
  toggle = await import('../src/cli/commands/toggle.js')
  update = await import('../src/cli/commands/update.js')
  switchVersion = await import('../src/cli/commands/switch-version.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
})

after(async () => {
  await removeTree(home)
  delete process.env.DSH_HOME
})

/** Create a repo that yields one flat `<name>.md` skill per given name. */
async function makeMultiSkillRepo(dir: string, names: string[]): Promise<void> {
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

async function entryOf(name: string) {
  const m = await manifest.readManifest()
  return m.skills.find((s) => s.name === name)!
}

test('disable --skill removes only that link and records the exclusion', async () => {
  const src = join(home, 'src-per')
  await makeMultiSkillRepo(src, ['p-one', 'p-two', 'p-three'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  for (const n of ['p-one', 'p-two', 'p-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }

  const { io, out } = captureIO()
  assert.equal(await toggle.toggle(['src-per', '--skill', 'skill-p-two'], false, io), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-p-two')), false)
  assert.equal(await exists(paths.skillLinkPath('skill-p-one')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-p-three')), true)

  // The entry stays enabled — two of its three links are still up.
  const entry = await entryOf('src-per')
  assert.equal(await link.isEntryEnabled(entry), true)
  assert.deepEqual(entry.excluded, ['skill-p-two'])
  assert.match(out.join(''), /Disabled skill "skill-p-two" of "src-per"/)
})

test('whole-entry disable then enable never resurrects the excluded skill', async () => {
  assert.equal(await toggle.toggle(['src-per'], false), 0)
  for (const n of ['p-one', 'p-two', 'p-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), false)
  }
  assert.equal(await toggle.toggle(['src-per'], true), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-p-one')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-p-three')), true)
  // The exclusion survives the round trip — this is the core of issue #25.
  assert.equal(await exists(paths.skillLinkPath('skill-p-two')), false)
})

test('update rebuild respects the exclusion', async () => {
  const src = join(home, 'src-per')
  const before = (await entryOf('src-per')).commit
  // Move upstream so update actually rebuilds links instead of short-circuiting.
  await writeFile(join(src, 'skill-p-one.md'), '---\nname: skill-p-one\n---\nS2', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'touch p-one'])

  assert.equal(await update.update([]), 0)
  const entry = await entryOf('src-per')
  assert.notEqual(entry.commit, before)
  assert.equal(await exists(paths.skillLinkPath('skill-p-one')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-p-three')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-p-two')), false)
  assert.deepEqual(entry.excluded, ['skill-p-two'])
})

test('switch-version rebuild respects the exclusion', async () => {
  const src = join(home, 'src-per')
  await writeFile(join(src, 'skill-p-three.md'), '---\nname: skill-p-three\n---\nS3', 'utf8')
  await git(src, ['add', '.'])
  await git(src, ['commit', '-m', 'touch p-three'])
  await git(src, ['tag', 'v2'])

  const { io } = captureIO()
  assert.equal(await switchVersion.switchVersion(['src-per', 'v2', '--type', 'tag'], io), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-p-one')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-p-three')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-p-two')), false)
})

test('enable --skill lifts the exclusion and restores the link', async () => {
  const { io, out } = captureIO()
  assert.equal(await toggle.toggle(['src-per', '--skill', 'skill-p-two'], true, io), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-p-two')), true)
  const entry = await entryOf('src-per')
  // An empty exclusion set drops the field entirely — no `excluded: []` noise.
  assert.equal(entry.excluded, undefined)
  assert.match(out.join(''), /Enabled skill "skill-p-two" of "src-per"/)
})

test('--json reports toggled then already, with the entry-level enabled state', async () => {
  const first = captureIO()
  assert.equal(await toggle.toggle(['src-per', '--skill', 'skill-p-two', '--json'], false, first.io), 0)
  const report = JSON.parse(first.out.join(''))
  assert.equal(report.version, 1)
  assert.deepEqual(report.summary, { toggled: 1, already: 0, failed: 0 })
  assert.deepEqual(report.results, [
    { name: 'src-per', action: 'disable', status: 'toggled', enabled: true, linksChanged: 1, already: false },
  ])

  // Disabling the same skill again changes nothing — intent and links agree.
  const second = captureIO()
  assert.equal(await toggle.toggle(['src-per', '--skill', 'skill-p-two', '--json'], false, second.io), 0)
  const again = JSON.parse(second.out.join(''))
  assert.deepEqual(again.summary, { toggled: 0, already: 1, failed: 0 })
  assert.equal(again.results[0].status, 'already')
  assert.equal(again.results[0].linksChanged, 0)
  assert.equal(again.results[0].enabled, true)

  // Restore for any later assertion in this file.
  assert.equal(await toggle.toggle(['src-per', '--skill', 'skill-p-two'], true), 0)
})

test('enable --skill on a disabled entry records intent only, link follows whole enable', async () => {
  const src = join(home, 'src-intent')
  await makeMultiSkillRepo(src, ['i-one', 'i-two'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  // Exclude one skill while the entry is on, then switch the whole entry off.
  assert.equal(await toggle.toggle(['src-intent', '--skill', 'skill-i-one'], false), 0)
  assert.equal(await toggle.toggle(['src-intent'], false), 0)

  // The entry is off, so no link may appear — but the exclusion must lift.
  const { io, out } = captureIO()
  assert.equal(await toggle.toggle(['src-intent', '--skill', 'skill-i-one', '--json'], true, io), 0)
  const report = JSON.parse(out.join(''))
  assert.equal(report.results[0].status, 'toggled')
  assert.equal(report.results[0].linksChanged, 0)
  assert.equal(report.results[0].enabled, false)
  assert.equal(await exists(paths.skillLinkPath('skill-i-one')), false)
  assert.equal((await entryOf('src-intent')).excluded, undefined)

  // The next whole-entry enable builds both links — the intent was recorded.
  assert.equal(await toggle.toggle(['src-intent'], true), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-i-one')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-i-two')), true)
})

test('a single-skill entry refuses --skill and points at the whole-entry toggle', async () => {
  const src = join(home, 'src-single')
  await makeMultiSkillRepo(src, ['solo'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)

  const { io, err } = captureIO()
  assert.equal(await toggle.toggle(['src-single', '--skill', 'skill-solo'], false, io), 1)
  assert.match(err.join(''), /single skill/)
  assert.match(err.join(''), /drop --skill/)
  // Nothing changed — neither the link nor the manifest.
  assert.equal(await exists(paths.skillLinkPath('src-single')), true)
  assert.equal((await entryOf('src-single')).excluded, undefined)
})

test('an unknown skill name fails without touching the entry', async () => {
  const { io, err } = captureIO()
  assert.equal(await toggle.toggle(['src-per', '--skill', 'nope'], false, io), 1)
  assert.match(err.join(''), /No skill named "nope" in entry "src-per"/)
  assert.equal((await entryOf('src-per')).excluded, undefined)
  for (const n of ['p-one', 'p-two', 'p-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }
})

test('--json maps an unknown skill to not-found and a single-skill entry to failed', async () => {
  const missing = captureIO()
  assert.equal(await toggle.toggle(['src-per', '--skill', 'nope', '--json'], false, missing.io), 1)
  const notFound = JSON.parse(missing.out.join(''))
  assert.equal(notFound.results[0].status, 'not-found')
  assert.deepEqual(notFound.summary, { toggled: 0, already: 0, failed: 1 })

  const single = captureIO()
  assert.equal(await toggle.toggle(['src-single', '--skill', 'skill-solo', '--json'], false, single.io), 1)
  const failed = JSON.parse(single.out.join(''))
  assert.equal(failed.results[0].status, 'failed')
  assert.match(failed.results[0].error, /single skill/)
})

/* ------------------------------------------------------------------ */
/* Whole-entry enable reconciliation (#22)                             */
/* ------------------------------------------------------------------ */

test('enable fills a partially lost link set instead of reporting already', async () => {
  const src = join(home, 'src-recon')
  await makeMultiSkillRepo(src, ['r-one', 'r-two', 'r-three'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  await link.unlinkSkill('skill-r-two')

  const { io, out } = captureIO()
  assert.equal(await toggle.toggle(['src-recon'], true, io), 0)
  assert.match(out.join(''), /Enabled "src-recon" — 1 symlink\(s\) created/)
  for (const n of ['r-one', 'r-two', 'r-three']) {
    assert.equal(await exists(paths.skillLinkPath(`skill-${n}`)), true)
  }

  // With the set complete again, enable is a true no-op.
  const second = captureIO()
  assert.equal(await toggle.toggle(['src-recon'], true, second.io), 0)
  assert.match(second.out.join(''), /already enabled/)
})

test('enable --json reports the reconcile as toggled with linksChanged = repaired count', async () => {
  await link.unlinkSkill('skill-r-three')
  const first = captureIO()
  assert.equal(await toggle.toggle(['src-recon', '--json'], true, first.io), 0)
  const report = JSON.parse(first.out.join(''))
  assert.deepEqual(report.results, [
    { name: 'src-recon', action: 'enable', status: 'toggled', enabled: true, linksChanged: 1, already: false },
  ])
  assert.deepEqual(report.summary, { toggled: 1, already: 0, failed: 0 })

  const second = captureIO()
  assert.equal(await toggle.toggle(['src-recon', '--json'], true, second.io), 0)
  const again = JSON.parse(second.out.join(''))
  assert.equal(again.results[0].status, 'already')
  assert.equal(again.results[0].linksChanged, 0)
  assert.equal(again.results[0].enabled, true)
})

test('enable never overwrites a real directory occupying a missing link slot', async () => {
  const src = join(home, 'src-coll')
  await makeMultiSkillRepo(src, ['c-one', 'c-two'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  await link.unlinkSkill('skill-c-two')
  const slot = paths.skillLinkPath('skill-c-two')
  await mkdir(slot, { recursive: true })
  await writeFile(join(slot, 'precious.txt'), 'user content', 'utf8')

  const { io, err } = captureIO()
  assert.equal(await toggle.toggle(['src-coll'], true, io), 0)
  assert.match(err.join(''), /"skill-c-two" is occupied by a real directory or file/)
  // User content untouched; the healthy link is left as it was.
  assert.equal(await exists(join(slot, 'precious.txt')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-c-one')), true)
})

test('the reconcile fills missing links without resurrecting an excluded skill', async () => {
  const src = join(home, 'src-recon-ex')
  await makeMultiSkillRepo(src, ['e-one', 'e-two', 'e-three'])
  assert.equal(await add.add([`${fileUrl(src)}#main`, '--yes']), 0)
  assert.equal(await toggle.toggle(['src-recon-ex', '--skill', 'skill-e-three'], false), 0)
  await link.unlinkSkill('skill-e-two')

  assert.equal(await toggle.toggle(['src-recon-ex'], true), 0)
  assert.equal(await exists(paths.skillLinkPath('skill-e-one')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-e-two')), true)
  assert.equal(await exists(paths.skillLinkPath('skill-e-three')), false)
  assert.deepEqual((await entryOf('src-recon-ex')).excluded, ['skill-e-three'])
})
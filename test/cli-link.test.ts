import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpsIO } from '../src/ops-io.js'
import { removeTree } from './fs-helpers.js'

/**
 * CLI tests for the `link` command.
 *
 * The promise under test is that `link trae-cn` discovers skills from a
 * trae-cn-like directory structure and creates external entries with the
 * correct naming convention. `--dry-run` previews without creating, `--json`
 * outputs structured data, and `--trae-cn-dir` overrides the default root.
 *
 * Unknown sources are refused with a usage error.
 */

let home: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let linker: typeof import('../src/link.js')
let linkCmd: typeof import('../src/cli/commands/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-cli-link-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  linker = await import('../src/link.js')
  linkCmd = await import('../src/cli/commands/link.js')
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
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody of ${name}.\n`
}

async function clearManifest(): Promise<void> {
  for (const entry of (await manifest.readManifest()).skills) {
    await manifest.removeEntry(entry.name)
  }
}

async function createTraeCnDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'nexus-cli-link-trae-'))
}

async function seedTraeCnSkill(traeCnDir: string, name: string): Promise<string> {
  const dir = join(traeCnDir, 'skills', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), skillMd(name))
  return dir
}

function captureIO(): { io: OpsIO; lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return {
    lines,
    errors,
    io: {
      confirm: async () => true,
      progress: () => {},
      emit: (line: string) => { lines.push(line) },
      error: (line: string) => { errors.push(line) },
      interactive: false,
    },
  }
}

/* ------------------------------------------------------------------ */
/* link trae-cn --dry-run                                              */
/* ------------------------------------------------------------------ */

test('link trae-cn --dry-run previews without creating entries', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'preview-skill')

    const { io, lines } = captureIO()
    const exitCode = await linkCmd.link(['trae-cn', '--dry-run', '--trae-cn-dir', traeCnDir], io)

    assert.equal(exitCode, 0)
    assert.ok(lines.some((l) => l.includes('preview-skill')), 'output mentions the skill')

    // Verify no entry was created.
    const m = await manifest.readManifest()
    assert.equal(m.skills.length, 0)
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* link trae-cn (execute)                                              */
/* ------------------------------------------------------------------ */

test('link trae-cn creates manifest entries and symlinks', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    const skillDir = await seedTraeCnSkill(traeCnDir, 'execute-skill')

    const { io } = captureIO()
    const exitCode = await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir], io)

    assert.equal(exitCode, 0)

    // Verify the entry was created.
    const m = await manifest.readManifest()
    const entry = m.skills.find((s) => s.name === 'trae-cn.skills.execute-skill')
    assert.ok(entry, 'entry not created')
    assert.equal(entry.ownership, 'external')
    assert.equal(entry.externalDir, skillDir)
    assert.deepEqual(entry.groupPath, ['trae-cn', 'skills', 'execute-skill'])

    // Verify the symlink exists.
    const linkPath = paths.skillLinkPath('trae-cn.skills.execute-skill')
    const linkTarget = await linker.safeRealPath(linkPath)
    assert.equal(await realpath(linkTarget), await realpath(skillDir))
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* link trae-cn --json                                                 */
/* ------------------------------------------------------------------ */

test('link trae-cn --json outputs structured data', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'json-skill')

    const { io, lines } = captureIO()
    const exitCode = await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir, '--json'], io)

    assert.equal(exitCode, 0)
    // JSON output should be parseable.
    const jsonLine = lines.find((l) => l.trim().startsWith('{'))
    assert.ok(jsonLine, 'JSON output present')
    const parsed = JSON.parse(jsonLine!)
    assert.ok(parsed.plan || parsed.result, 'JSON carries plan or result')
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* link unknown-source                                                 */
/* ------------------------------------------------------------------ */

test('link unknown-source reports usage error', async () => {
  await clearManifest()
  const { io, errors } = captureIO()
  const exitCode = await linkCmd.link(['unknown-source'], io)

  assert.equal(exitCode, 1)
  assert.ok(errors.some((e) => e.includes('unknown') || e.includes('unsupported')), 'error mentions unknown source')
})

/* ------------------------------------------------------------------ */
/* link trae-cn (conflict)                                             */
/* ------------------------------------------------------------------ */

test('link trae-cn reports conflict on duplicate run', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'conflict-skill')

    // First run succeeds.
    const { io: io1 } = captureIO()
    const exitCode1 = await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir], io1)
    assert.equal(exitCode1, 0)

    // Second run reports conflict.
    const { io: io2, lines: lines2 } = captureIO()
    const _exitCode2 = await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir], io2)
    // Exit code may be 0 (with warnings) or 1 (with errors), depending on implementation.
    // The key assertion is that the conflict is reported.
    assert.ok(
      lines2.some((l) => l.includes('conflict') || l.includes('already') || l.includes('exists')),
      'conflict is reported',
    )
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

test('link trae-cn --force bypasses conflict', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'force-skill')

    // First run.
    const { io: io1 } = captureIO()
    await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir], io1)

    // Second run with --force succeeds.
    const { io: io2 } = captureIO()
    const exitCode = await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir, '--force'], io2)
    assert.equal(exitCode, 0)
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* link trae-cn --group                                                */
/* ------------------------------------------------------------------ */

for (const json of [false, true]) {
  test(`link trae dry-run is read-only (${json ? 'JSON' : 'human'})`, async (t) => {
    await clearManifest()
    const root = await createTraeCnDir()
    t.after(() => removeTree(root))
    const skillDir = await seedTraeCnSkill(root, `trae-preview-${json}`)
    const { io, lines, errors } = captureIO()
    const code = await linkCmd.link(['trae', '--source-dir', root, '--dry-run', ...(json ? ['--json'] : [])], io)
    assert.equal(code, 0)
    assert.deepEqual(errors, [])
    assert.equal((await manifest.readManifest()).skills.length, 0)
    await assert.rejects(lstat(paths.skillLinkPath(`trae.skills.trae-preview-${json}`)), { code: 'ENOENT' })
    if (json) {
      const report = JSON.parse(lines.join(''))
      assert.equal(report.version, 1)
      assert.equal(report.plan.source, 'trae')
      assert.equal(report.plan.entries[0].externalDir, skillDir)
      assert.equal(report.result, undefined)
    } else assert.match(lines.join(''), /Would create 1 entry/)
  })

  test(`link trae creates external entries and symlinks (${json ? 'JSON' : 'human'})`, async (t) => {
    await clearManifest()
    const root = await createTraeCnDir()
    t.after(() => removeTree(root))
    const skill = `trae-execute-${json}`
    const skillDir = await seedTraeCnSkill(root, skill)
    const name = `trae.skills.${skill}`
    const { io, lines, errors } = captureIO()
    assert.equal(await linkCmd.link(['trae', `--source-dir=${root}`, ...(json ? ['--json'] : [])], io), 0)
    assert.deepEqual(errors, [])
    const entry = (await manifest.readManifest()).skills.find((e) => e.name === name)!
    assert.equal(entry.ownership, 'external')
    assert.equal(entry.externalDir, skillDir)
    assert.equal(entry.url, `trae:skills/${skill}`)
    assert.deepEqual(entry.groupPath, ['trae', 'skills', skill])
    assert.equal(await realpath(paths.skillLinkPath(name)), await realpath(skillDir))
    assert.equal(await readFile(join(skillDir, 'SKILL.md'), 'utf8'), skillMd(skill))
    if (json) {
      const report = JSON.parse(lines.join(''))
      assert.equal(report.version, 1)
      assert.equal(report.plan.source, 'trae')
      assert.deepEqual(report.result, { added: [name], skipped: [] })
    } else assert.match(lines.join(''), /Linked 1 skill\(s\) from trae:/)
  })
}

test('link trae reports conflicts and --force retargets to the newly selected root', async (t) => {
  await clearManifest()
  const root = await createTraeCnDir()
  t.after(() => removeTree(root))
  const first = await seedTraeCnSkill(join(root, 'first'), 'trae-conflict')
  const second = await seedTraeCnSkill(join(root, 'second'), 'trae-conflict')
  const name = 'trae.skills.trae-conflict'
  assert.equal(await linkCmd.link(['trae', '--source-dir', join(root, 'first')], captureIO().io), 0)
  const duplicate = captureIO()
  assert.equal(await linkCmd.link(['trae', '--source-dir', join(root, 'second'), '--json'], duplicate.io), 0)
  assert.deepEqual(JSON.parse(duplicate.lines.join('')).result, { added: [], skipped: [name] })
  assert.equal(await realpath(paths.skillLinkPath(name)), await realpath(first))
  const forced = captureIO()
  assert.equal(await linkCmd.link(['trae', '--source-dir', join(root, 'second'), '--force', '--json'], forced.io), 0)
  assert.deepEqual(JSON.parse(forced.lines.join('')).result, { added: [name], skipped: [] })
  assert.equal((await manifest.readManifest()).skills.length, 1)
  assert.equal(await realpath(paths.skillLinkPath(name)), await realpath(second))
  assert.equal(await readFile(join(first, 'SKILL.md'), 'utf8'), skillMd('trae-conflict'))
})

test('link trae --group changes only the group, not source identity', async (t) => {
  await clearManifest()
  const root = await createTraeCnDir()
  t.after(() => removeTree(root))
  await seedTraeCnSkill(root, 'trae-group')
  assert.equal(await linkCmd.link(['trae', '--source-dir', root, '--group', 'custom-trae'], captureIO().io), 0)
  const entry = (await manifest.readManifest()).skills[0]!
  assert.equal(entry.name, 'custom-trae.skills.trae-group')
  assert.deepEqual(entry.groupPath, ['custom-trae', 'skills', 'trae-group'])
  assert.equal(entry.url, 'trae:skills/trae-group')
})

for (const source of ['trae-cn', 'trae']) {
  test(`link ${source}: new directory flag wins over alias and environment in either order`, async (t) => {
    await clearManifest()
    const root = await createTraeCnDir()
    const envVar = source === 'trae' ? 'TRAE_DIR' : 'TRAE_CN_DIR'
    const previous = process.env[envVar]
    t.after(async () => {
      if (previous === undefined) delete process.env[envVar]
      else process.env[envVar] = previous
      await removeTree(root)
    })
    process.env[envVar] = join(root, 'missing-env')
    const dir = await seedTraeCnSkill(root, 'override')
    for (const flags of [
      ['--source-dir', root, '--trae-cn-dir', join(root, 'missing-alias')],
      ['--trae-cn-dir', join(root, 'missing-alias'), '--source-dir', root],
    ]) {
      const { io, lines } = captureIO()
      assert.equal(await linkCmd.link([source, '--dry-run', '--json', ...flags], io), 0)
      const report = JSON.parse(lines.join(''))
      assert.equal(report.plan.source, source)
      assert.equal(report.plan.entries[0].externalDir, dir)
    }
  })
}

test('link trae uses TRAE_DIR independently and empty results name the selected source', async (t) => {
  await clearManifest()
  const root = await createTraeCnDir()
  const previous = { trae: process.env.TRAE_DIR, cn: process.env.TRAE_CN_DIR }
  t.after(async () => {
    if (previous.trae === undefined) delete process.env.TRAE_DIR
    else process.env.TRAE_DIR = previous.trae
    if (previous.cn === undefined) delete process.env.TRAE_CN_DIR
    else process.env.TRAE_CN_DIR = previous.cn
    await removeTree(root)
  })
  process.env.TRAE_DIR = root
  process.env.TRAE_CN_DIR = join(root, 'missing-cn')
  for (const flags of [[], ['--dry-run']]) {
    const { io, lines } = captureIO()
    assert.equal(await linkCmd.link(['trae', ...flags], io), 0)
    assert.equal(lines.join(''), 'No skills found under the trae root.\n')
  }
  await seedTraeCnSkill(root, 'env-skill')
  const { io, lines } = captureIO()
  assert.equal(await linkCmd.link(['trae', '--dry-run', '--json'], io), 0)
  assert.equal(JSON.parse(lines.join('')).plan.entries[0].name, 'trae.skills.env-skill')
})

test('link missing source-dir is a usage error and never writes state', async () => {
  await clearManifest()
  const { io, errors } = captureIO()
  assert.equal(await linkCmd.link(['trae', '--source-dir', '--json'], io), 2)
  assert.match(errors.join(''), /--source-dir requires a path/)
  assert.equal((await manifest.readManifest()).skills.length, 0)
})

test('link trae-cn --group overrides L1 group name', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'group-skill')

    const { io } = captureIO()
    const exitCode = await linkCmd.link(['trae-cn', '--trae-cn-dir', traeCnDir, '--group', 'custom-group'], io)

    assert.equal(exitCode, 0)

    // Verify the entry uses the custom group name.
    const m = await manifest.readManifest()
    const entry = m.skills.find((s) => s.name === 'custom-group.skills.group-skill')
    assert.ok(entry, 'entry with custom group not created')
    assert.deepEqual(entry.groupPath, ['custom-group', 'skills', 'group-skill'])
  } finally {
    await rm(traeCnDir, { recursive: true, force: true })
  }
})

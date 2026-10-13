import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpsIO } from '../src/ops-io.js'

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
  await rm(home, { recursive: true, force: true })
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

async function seedTraeCnSkill(
  traeCnDir: string,
  subdir: 'skills' | 'builtin_skills',
  name: string,
): Promise<string> {
  const dir = join(traeCnDir, subdir, name)
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
    await seedTraeCnSkill(traeCnDir, 'skills', 'preview-skill')

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
    const skillDir = await seedTraeCnSkill(traeCnDir, 'skills', 'execute-skill')

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
    assert.equal(linkTarget, skillDir)
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
    await seedTraeCnSkill(traeCnDir, 'skills', 'json-skill')

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
    await seedTraeCnSkill(traeCnDir, 'skills', 'conflict-skill')

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
    await seedTraeCnSkill(traeCnDir, 'skills', 'force-skill')

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

test('link trae-cn --group overrides L1 group name', async () => {
  await clearManifest()
  const traeCnDir = await createTraeCnDir()
  try {
    await seedTraeCnSkill(traeCnDir, 'skills', 'group-skill')

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

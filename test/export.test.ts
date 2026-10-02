import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { NexusPackage } from '../src/export.js'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Module-level tests for the `export` core — channel C of the source &
 * migration design (`docs/source-and-migration-design.md` §4.1/§5).
 *
 * They assert on the package itself: the label (what the importer needs to
 * restore an entry) and the payload (files, minus `.git`), plus the PKZip codec
 * round trip and the `ownership: 'external'` boundary. The CLI surface is
 * covered by the command-level tests in the same file.
 *
 * `paths.ts` reads `DSH_HOME` at import time, so the env var is set in
 * `before()` before the first import of the manifest→paths chain (same pattern
 * as remove.test.ts). Filesystem and manifest state live in a throwaway
 * `DSH_HOME`, and packages are written to a separate scratch directory.
 */

let home: string
let work: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let linker: typeof import('../src/link.js')
let codec: typeof import('../src/zip.js')
let exporter: typeof import('../src/export.js')
let remover: typeof import('../src/remove.js')
let cli: typeof import('../src/cli/commands/export.js')

/** The OpsIO seam, so CLI tests never patch process.stdout. */
function captureIO(): { io: OpsIO; lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    io: {
      confirm: async () => true,
      progress: () => {},
      emit: (line: string) => {
        lines.push(line)
      },
      interactive: false,
    },
  }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-export-home-'))
  work = await mkdtemp(join(tmpdir(), 'nexus-export-out-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  linker = await import('../src/link.js')
  codec = await import('../src/zip.js')
  exporter = await import('../src/export.js')
  remover = await import('../src/remove.js')
  cli = await import('../src/cli/commands/export.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
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

async function addEntry(overrides: Partial<SkillEntry> & { name: string }): Promise<void> {
  await manifest.addEntry({
    url: `github:owner/${overrides.name}`,
    gitUrl: `https://github.com/owner/${overrides.name}.git`,
    ref: 'main',
    commit: 'abc1234',
    path: overrides.name,
    addedAt: new Date().toISOString(),
    ...overrides,
  })
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

/** Create an entry's directory under <repos> with a valid SKILL.md. */
async function seedSkill(name: string, files?: Record<string, string>): Promise<string> {
  const root = paths.repoDir(name)
  await writeFiles(root, files ?? { 'SKILL.md': skillMd(name) })
  return root
}

/** Read a zip package back through the package codec. */
async function readPackage(out: string): Promise<{ label: NexusPackage; files: Map<string, Buffer> }> {
  const files = new Map(codec.readZip(await readFile(out)).map((f) => [f.name, f.data]))
  const raw = files.get(exporter.PACKAGE_MANIFEST)
  assert.ok(raw !== undefined, 'the package carries a label')
  return { label: JSON.parse(raw.toString('utf8')) as NexusPackage, files }
}

/* ------------------------------------------------------------------ */
/* Package contents                                                    */
/* ------------------------------------------------------------------ */

test('a named export writes a zip carrying the label and the skill files', async () => {
  await clearManifest()
  await seedSkill('alpha', {
    'SKILL.md': skillMd('alpha'),
    'references/notes.md': 'notes\n',
  })
  await addEntry({ name: 'alpha' })
  await linker.linkSkill('alpha', paths.repoDir('alpha'))

  const out = join(work, 'alpha.zip')
  const result = await exporter.exportSkills({ names: ['alpha'], out })

  assert.equal(result.format, 'zip')
  assert.equal(result.entries, 1)
  assert.equal(result.files, 2)
  assert.deepEqual(result.skipped, [])

  const { label, files } = await readPackage(out)
  assert.equal(label.schema, 'dsh-skills-nexus/package')
  assert.equal(label.version, 1)
  assert.match(label.generator, /^dsh-skills-nexus\b/)
  assert.ok(!Number.isNaN(Date.parse(label.exportedAt)), 'exportedAt is an ISO timestamp')
  assert.deepEqual([...files.keys()].sort(), [
    'nexus-package.json',
    'skills/alpha/SKILL.md',
    'skills/alpha/references/notes.md',
  ])
  assert.equal(files.get('skills/alpha/references/notes.md')!.toString('utf8'), 'notes\n')

  const entry = label.entries[0]!
  assert.equal(entry.name, 'alpha')
  assert.equal(entry.url, 'github:owner/alpha')
  assert.equal(entry.gitUrl, 'https://github.com/owner/alpha.git')
  assert.equal(entry.ref, 'main')
  assert.equal(entry.commit, 'abc1234')
  assert.equal(entry.subdir, undefined)
  assert.equal(entry.enabled, true)
  assert.deepEqual(entry.skills, [
    { root: 'skills/alpha', name: 'alpha', description: 'alpha skill', links: ['alpha'] },
  ])
})

test('--all exports disabled entries too and records enabled: false', async () => {
  await clearManifest()
  await seedSkill('on')
  await seedSkill('off')
  await addEntry({ name: 'on' })
  await addEntry({ name: 'off' })
  await linker.linkSkill('on', paths.repoDir('on'))

  const out = join(work, 'all.zip')
  const result = await exporter.exportSkills({ all: true, out })
  assert.equal(result.entries, 2)

  const { label } = await readPackage(out)
  const byName = new Map(label.entries.map((e) => [e.name, e]))
  assert.equal(byName.get('on')!.enabled, true)
  assert.equal(byName.get('off')!.enabled, false)
  assert.deepEqual(byName.get('off')!.skills[0]!.links, [])
})

test('a package never carries .git', async () => {
  await clearManifest()
  await seedSkill('withgit', {
    'SKILL.md': skillMd('withgit'),
    '.git/config': '[remote "origin"]\n\turl = https://user:token@example.com/x.git\n',
  })
  await addEntry({ name: 'withgit' })

  const out = join(work, 'withgit.zip')
  const result = await exporter.exportSkills({ names: ['withgit'], out })
  assert.equal(result.files, 1)

  const { files } = await readPackage(out)
  assert.equal(
    [...files.keys()].some((name) => name.split('/').includes('.git')),
    false,
        )
})

test('a --subdir entry exports only its subdirectory and records the offset', async () => {
  await clearManifest()
  const root = await seedSkill('collection', {
    'README.md': 'docs\n',
    'skills/foo/SKILL.md': skillMd('foo'),
    'skills/bar/SKILL.md': skillMd('bar'),
  })
  await addEntry({ name: 'foo-entry', path: 'collection', subdir: 'skills/foo' })
  await linker.linkSkill('foo-entry', join(root, 'skills', 'foo'))

  const out = join(work, 'foo.zip')
  const result = await exporter.exportSkills({ names: ['foo-entry'], out })
  assert.equal(result.files, 1)

  const { label, files } = await readPackage(out)
  assert.deepEqual([...files.keys()].sort(), ['nexus-package.json', 'skills/foo-entry/SKILL.md'])
  assert.equal(label.entries[0]!.subdir, 'skills/foo')
  assert.deepEqual(label.entries[0]!.skills, [
    { root: 'skills/foo-entry', name: 'foo', description: 'foo skill', links: ['foo-entry'] },
  ])
})

test('links are attributed per skill, so an unlinked sibling carries none', async () => {
  await clearManifest()
  const root = await seedSkill('two', {
    'alpha/SKILL.md': skillMd('alpha'),
    'beta/SKILL.md': skillMd('beta'),
  })
  await addEntry({ name: 'two' })
  await linker.linkSkill('alpha', join(root, 'alpha'))

  const out = join(work, 'two.zip')
  await exporter.exportSkills({ names: ['two'], out })

  const { label } = await readPackage(out)
  const skills = label.entries[0]!.skills
  const alpha = skills.find((s) => s.name === 'alpha')!
  const beta = skills.find((s) => s.name === 'beta')!
  assert.deepEqual(alpha.links, ['alpha'])
  assert.equal(alpha.root, 'skills/two/alpha')
  assert.deepEqual(beta.links, [])
  assert.equal(label.entries[0]!.enabled, true)
})

test('a directory output writes the same label and payload as a zip', async () => {
  await clearManifest()
  await seedSkill('dirout')
  await addEntry({ name: 'dirout' })

  const out = join(work, 'pkg-dir')
  const result = await exporter.exportSkills({ names: ['dirout'], out })
  assert.equal(result.format, 'directory')

  const label = JSON.parse(
    await readFile(join(out, 'nexus-package.json'), 'utf8'),
  ) as NexusPackage
  assert.equal(label.entries[0]!.name, 'dirout')
  assert.equal((await stat(join(out, 'skills', 'dirout', 'SKILL.md'))).isFile(), true)
})

/* ------------------------------------------------------------------ */
/* What a package deliberately leaves out                              */
/* ------------------------------------------------------------------ */

test('a missing directory fails a named export and is skipped by --all', async () => {
  await clearManifest()
  await seedSkill('here')
  await addEntry({ name: 'here' })
  await addEntry({ name: 'gone' })

  await assert.rejects(
    exporter.exportSkills({ names: ['gone'], out: join(work, 'gone.zip') }),
    /has no directory/,
  )

  const out = join(work, 'mixed.zip')
  const result = await exporter.exportSkills({ all: true, out })
  assert.equal(result.entries, 1)
  assert.deepEqual(result.skipped, [{ name: 'gone', reason: 'directory missing' }])

  const { label } = await readPackage(out)
  assert.deepEqual(label.skipped, [{ name: 'gone', reason: 'directory missing' }])
})

test('external (link-only) entries are skipped by --all and refused by name', async () => {
  await clearManifest()
  await seedSkill('managed')
  await addEntry({ name: 'managed' })
  await addEntry({
    name: 'linked',
    gitUrl: '',
    ref: '',
    commit: '',
    ownership: 'external',
  })

  await assert.rejects(
    exporter.exportSkills({ names: ['linked'], out: join(work, 'linked.zip') }),
    /does not own/,
  )

  const out = join(work, 'managed-only.zip')
  const result = await exporter.exportSkills({ all: true, out })
  assert.equal(result.entries, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0]!.name, 'linked')
  assert.match(result.skipped[0]!.reason, /external/)
})

test('export refuses unknown names, an empty manifest and an empty selection', async () => {
  await clearManifest()
  await assert.rejects(
    exporter.exportSkills({ names: ['nope'], out: join(work, 'x.zip') }),
    /no skill named/,
  )
  await assert.rejects(
    exporter.exportSkills({ all: true, out: join(work, 'y.zip') }),
    /no entries to export/,
  )
  await assert.rejects(exporter.exportSkills({ out: join(work, 'z.zip') }), /nothing to export/)
})

/* ------------------------------------------------------------------ */
/* The ownership boundary                                              */
/* ------------------------------------------------------------------ */

test('remove deletes an external entry but never its directory', async () => {
  await clearManifest()
  // Guard test: nexus never creates `repos/<path>` for a link-only entry, so
  // the directory that has to survive is planted by hand. Without the
  // ownership check in src/remove.ts it would be deleted.
  const planted = paths.repoDir('planted')
  await writeFiles(planted, { 'SKILL.md': skillMd('planted') })
  await addEntry({ name: 'planted', gitUrl: '', ref: '', commit: '', ownership: 'external' })
  await linker.linkSkill('planted', planted)

  const result = await remover.removeSkill('planted')
  assert.equal(result.removed, true)
  assert.deepEqual(result.links, ['planted'])
  assert.equal((await stat(planted)).isDirectory(), true)
  assert.deepEqual((await manifest.readManifest()).skills, [])
})

test('the ownership marker is what protects the directory (control)', async () => {
  await clearManifest()
  const managed = paths.repoDir('managed-dir')
  await writeFiles(managed, { 'SKILL.md': skillMd('managed-dir') })
  await addEntry({ name: 'managed-dir' })

  const result = await remover.removeSkill('managed-dir')
  assert.equal(result.removed, true)
  await assert.rejects(stat(managed), 'a managed directory is deleted with its entry')
})

/* ------------------------------------------------------------------ */
/* Codec guards                                                        */
/* ------------------------------------------------------------------ */

test('createZip refuses paths that would escape the package root', () => {
  const data = Buffer.from('x')
  assert.throws(() => codec.createZip([{ name: '../escape', data }]), /escapes/)
  assert.throws(() => codec.createZip([{ name: '/absolute', data }]), /absolute/)
  assert.throws(() => codec.createZip([{ name: 'C:/drive', data }]), /absolute/)
  assert.throws(() => codec.createZip([{ name: 'a//b', data }]), /empty path segment/)
  assert.throws(() => codec.createZip([{ name: 'a\\b', data }]), /backslash/)
  assert.throws(() => codec.createZip([{ name: 'a:b', data }]), /":" segment/)
})

test('a zip written by createZip round-trips through readZip byte for byte', () => {
  const files = [
    { name: 'nexus-package.json', data: Buffer.from('{"a":1}\n', 'utf8') },
    { name: 'skills/中文 名称/SKILL.md', data: Buffer.from('# 标题\n', 'utf8') },
  ]
  const back = codec.readZip(codec.createZip(files))
  assert.deepEqual(
    back.map((f) => [f.name, f.data.toString('utf8')]),
    files.map((f) => [f.name, f.data.toString('utf8')]),
  )
})

/* ------------------------------------------------------------------ */
/* CLI surface                                                         */
/* ------------------------------------------------------------------ */

test('the CLI writes a package and reports where it went', async () => {
  await clearManifest()
  await seedSkill('cli')
  await addEntry({ name: 'cli' })

  const out = join(work, 'cli-pkg.zip')
  const { io, lines } = captureIO()
  assert.equal(await cli.exportCommand(['cli', '--out', out], io), 0)
  assert.equal((await stat(out)).isFile(), true)
  const text = lines.join('')
  assert.match(text, /1 entry, 1 file/)
  assert.match(text, /cli-pkg\.zip/)
})

test('--out=value is equivalent to the space form', async () => {
  await clearManifest()
  await seedSkill('eq')
  await addEntry({ name: 'eq' })

  const out = join(work, 'eq-pkg.zip')
  const { io } = captureIO()
  assert.equal(await cli.exportCommand(['eq', `--out=${out}`], io), 0)
  assert.equal((await stat(out)).isFile(), true)
})

test('the CLI default output name follows the entry name and the date', async () => {
  await clearManifest()
  await seedSkill('named')
  await addEntry({ name: 'named' })

  const previous = process.cwd()
  process.chdir(work)
  try {
    const single = captureIO()
    assert.equal(await cli.exportCommand(['named'], single.io), 0)
    assert.equal((await stat(join(work, 'named.zip'))).isFile(), true)

    const everything = captureIO()
    assert.equal(await cli.exportCommand(['--all'], everything.io), 0)
    const dated = (await readdir(work)).filter((f) => /^nexus-export-\d{8}\.zip$/.test(f))
    assert.equal(dated.length, 1, 'a dated package name is used for --all')
  } finally {
    process.chdir(previous)
  }
})

test('usage errors exit 2 and write nothing', async () => {
  const cases: string[][] = [
    [],
    ['--nope'],
    ['alpha', '--all'],
    ['alpha', '--out'],
    ['--out', join(work, 'never.zip'), 'extra', '--bogus'],
  ]
  for (const argv of cases) {
    const { io, lines } = captureIO()
    assert.equal(await cli.exportCommand(argv, io), 2, `argv: ${argv.join(' ')}`)
    assert.deepEqual(lines, [], 'a usage error emits nothing on stdout')
  }
})

test('a failing export exits 1', async () => {
  await clearManifest()
  const { io } = captureIO()
  assert.equal(await cli.exportCommand(['ghost', '--out', join(work, 'ghost.zip')], io), 1)
})

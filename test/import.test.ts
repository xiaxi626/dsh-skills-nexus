import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { SkillEntry } from '../src/types.js'
import type { NexusPackage, PackageEntry } from '../src/export.js'
import type { ImportDecision, ImportError, ImportOptions, ImportPlan } from '../src/import.js'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Module-level tests for the `import` core — channel C of the source &
 * migration design (`docs/source-and-migration-design.md` §4.2/§10).
 *
 * The promise under test is that a package is more than an archive. When the
 * label records a remote that answers, the entry comes back as a real clone —
 * a git entry `update` and `switch-version` can work with. When the remote
 * cannot answer, or the caller asked for `--no-remote`, the payload lands as a
 * snapshot that still carries the exporting machine's enabled flag and link
 * names, so the receiving catalog looks like the sending one. A package
 * *without* a label (another tool's zip) is a foreign artifact: its skills are
 * found by the peel scan, which is deliberately more forgiving than the
 * installer's three discovery rules, and §4.2 grades a failure to find them
 * (`no-skill-found` vs `skill-nested-too-deep`) so a caller knows whether
 * `--subdir` is the way out.
 *
 * `paths.ts` reads `DSH_HOME` at import time, so the env var is set in
 * `before()` before the first import of the manifest→paths chain (same pattern
 * as export.test.ts). Filesystem and manifest state live in a throwaway
 * `DSH_HOME`, packages in a separate scratch directory. Every remote fixture is
 * a local `file://` path: probes either answer locally or fail locally, so the
 * suite never needs the network.
 */

const execFileAsync = promisify(execFile)

let home: string
let work: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let linker: typeof import('../src/link.js')
let codec: typeof import('../src/zip.js')
let exporter: typeof import('../src/export.js')
let importer: typeof import('../src/import.js')
let installer: typeof import('../src/install.js')
let gitMod: typeof import('../src/git.js')
let remover: typeof import('../src/remove.js')
let cli: typeof import('../src/cli/commands/import.js')

/** Silent OpsIO for the core tests; CLI tests capture their own lines. */
const io: OpsIO = {
  confirm: async () => true,
  progress: () => {},
  emit: () => {},
  interactive: false,
}

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
  home = await mkdtemp(join(tmpdir(), 'nexus-import-home-'))
  work = await mkdtemp(join(tmpdir(), 'nexus-import-pkg-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  // `link`, `install` and the command modules must arrive through the same
  // dynamic chain: a *static* import of src/link.ts would evaluate paths.ts
  // while the module graph loads — before DSH_HOME is repointed — so every
  // symlink write would land in the real ~/.dsh (observed once in
  // update.test.ts: the whole suite registered into the user's home).
  linker = await import('../src/link.js')
  codec = await import('../src/zip.js')
  exporter = await import('../src/export.js')
  importer = await import('../src/import.js')
  installer = await import('../src/install.js')
  gitMod = await import('../src/git.js')
  remover = await import('../src/remove.js')
  cli = await import('../src/cli/commands/import.js')
  assert.ok(
    paths.OFFICIAL_SKILLS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.OFFICIAL_SKILLS_DIR}`,
  )
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

/** `file://` URL of a directory — the only remote shape this suite uses. */
function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

/**
 * A remote that cannot exist. A probe against it fails on the local filesystem
 * instead of on the network, which is what keeps the whole file offline — the
 * `no-source`/`no-remote`/`not-checked` verdicts must not depend on a timeout.
 */
function missingRemote(name: string): string {
  return fileUrl(join(home, 'no-such-remote', name))
}

async function addEntry(overrides: Partial<SkillEntry> & { name: string }): Promise<void> {
  await manifest.addEntry({
    url: `github:owner/${overrides.name}`,
    gitUrl: missingRemote(overrides.name),
    ref: 'main',
    commit: 'abc1234',
    path: overrides.name,
    addedAt: new Date().toISOString(),
    ...overrides,
  })
}

const git = async (dir: string, args: string[]): Promise<void> => {
  await execFileAsync('git', args, { cwd: dir })
}

/** Create a source repo with one commit on `main` (the update.test.ts shape). */
async function makeRepo(dir: string, skill: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(join(dir, 'SKILL.md'), skillMd(skill), 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'initial'])
}

/** Write a hand-built archive into the scratch directory. */
async function writeZip(fileName: string, files: Record<string, string>): Promise<string> {
  const out = join(work, fileName)
  const entries = Object.entries(files).map(([name, text]) => ({
    name,
    data: Buffer.from(text, 'utf8'),
  }))
  await writeFile(out, codec.createZip(entries))
  return out
}

/** The label a package carries, read back through the package codec. */
async function readLabel(out: string): Promise<NexusPackage> {
  const files = new Map(codec.readZip(await readFile(out)).map((f) => [f.name, f.data]))
  const raw = files.get(exporter.PACKAGE_MANIFEST)
  assert.ok(raw !== undefined, 'the package carries a label')
  return JSON.parse(raw.toString('utf8')) as NexusPackage
}

/**
 * The label body of a hand-built package. `export` cannot produce one without
 * payload files, so the manifest-only case below builds its own.
 */
function labelWith(entries: Array<Partial<PackageEntry> & { name: string }>): string {
  return JSON.stringify({
    schema: exporter.PACKAGE_SCHEMA,
    version: exporter.PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    generator: 'test fixture',
    skipped: [],
    entries: entries.map((entry) => ({
      url: `github:owner/${entry.name}`,
      gitUrl: '',
      ref: '',
      commit: '',
      enabled: true,
      skills: [
        {
          root: `skills/${entry.name}`,
          name: entry.name,
          description: `${entry.name} skill`,
          links: [],
        },
      ],
      ...entry,
    })),
  })
}

/** Everything but the package path; the helpers below supply `source` and `io`. */
type PlanOptions = Partial<Omit<ImportOptions, 'source' | 'io'>>

/** Stage a package, plan it, and remove the temporary copy — read-only. */
async function planOf(source: string, options: PlanOptions = {}): Promise<ImportPlan> {
  const staged = await importer.stagePackage(source)
  try {
    return await importer.planStaged(staged, { source, io, ...options })
  } finally {
    await staged.cleanup()
  }
}

/**
 * The graded refusal a package produces. The `code` is the contract (§10.4):
 * callers branch on it, so a package that is refused for the wrong reason has
 * to fail here rather than pass as "some error".
 */
async function refusalOf(source: string, options: PlanOptions = {}): Promise<ImportError> {
  try {
    await planOf(source, options)
  } catch (err) {
    assert.ok(err instanceof importer.ImportError, `expected an ImportError, got ${String(err)}`)
    return err
  }
  assert.fail('the package was accepted; it has to be refused')
}

async function readTextOrMissing(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return '<missing>'
  }
}

async function listOrMissing(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return ['<missing>']
  }
}

/**
 * Everything a dry run could disturb: the manifest bytes, the clone directory
 * listing and the skills-root listing. Compared as a whole so an unexpected
 * *extra* write is caught too, not just a changed file.
 */
async function nexusState(): Promise<{ manifest: string; repos: string[]; skills: string[] }> {
  return {
    manifest: await readTextOrMissing(paths.MANIFEST_PATH),
    repos: await listOrMissing(paths.REPOS_DIR),
    skills: await listOrMissing(paths.OFFICIAL_SKILLS_DIR),
  }
}

/* ------------------------------------------------------------------ */
/* The round trip — the feature's whole promise                        */
/* ------------------------------------------------------------------ */

test('a labelled package round-trips an entry back into an updatable git clone', async () => {
  await clearManifest()
  const remoteDir = join(home, 'remote-round-trip')
  await makeRepo(remoteDir, 'round-trip')
  const remote = fileUrl(remoteDir)
  const head = await gitMod.getHeadCommit(remoteDir)

  // Install the way `add` does, so the entry starts life as a real clone with a
  // link — the state a user migrates away from.
  const installed = await installer.installFromGit({
    spec: remote,
    gitSpec: gitMod.parseGitSpec(remote),
    subdir: undefined,
    skillName: 'round-trip',
    path: 'round-trip',
    name: undefined,
    subdirLeaf: undefined,
    yes: true,
    io,
  })
  assert.equal(installed.status, 'installed')
  assert.deepEqual(installed.links, ['round-trip'])

  const out = join(work, 'round-trip-package.zip')
  const exported = await exporter.exportSkills({ names: ['round-trip'], out })
  assert.equal(exported.entries, 1)

  // The migration itself: the entry is wiped from this machine while the remote
  // it came from stays where it was.
  const removed = await remover.removeSkill('round-trip')
  assert.equal(removed.removed, true)
  await assert.rejects(stat(paths.repoDir('round-trip')), 'the clone went with the entry')

  const { plan, result } = await importer.importPackage({ source: out, io })
  assert.equal(
    plan.entries[0]!.decision.kind,
    'git',
    'a recorded remote that answers wins over the payload files',
  )
  assert.ok(result !== undefined)
  assert.deepEqual(result.failed, [])
  assert.equal(result.installed.length, 1)
  assert.equal(result.installed[0]!.kind, 'git')

  const entry = (await manifest.readManifest()).skills.find((s) => s.name === 'round-trip')
  assert.ok(entry !== undefined, 'the entry is registered again')
  // A git entry, not a copied tree: `update` and `switch-version` refuse an
  // entry without a recorded remote, so only this makes the round trip real.
  assert.equal(manifest.hasGitSource(entry!), true)
  const clone = paths.repoDir(entry!.path)
  assert.equal((await stat(join(clone, '.git'))).isDirectory(), true)
  assert.equal(await gitMod.getHeadCommit(clone), head, 'the clone sits on the recorded ref')
  assert.equal((await stat(join(clone, 'SKILL.md'))).isFile(), true)
  // The links are back, pointing into the fresh clone.
  assert.deepEqual((await linker.entryLinks(entry!)).map((l) => l.name), ['round-trip'])
})

/* ------------------------------------------------------------------ */
/* The snapshot channel                                                */
/* ------------------------------------------------------------------ */

test('an entry exported without links is imported disabled', async () => {
  await clearManifest()
  await seedSkill('off-src')
  await addEntry({ name: 'off-src' })

  const out = join(work, 'off-package.zip')
  await exporter.exportSkills({ names: ['off-src'], out })
  const label = await readLabel(out)
  assert.equal(label.entries[0]!.enabled, false, 'nothing pointed at the entry when it was exported')

  // `--no-remote` forces the snapshot channel; the new name leaves the source
  // entry in place, so what is asserted is the import and not a replacement.
  const { result } = await importer.importPackage({
    source: out,
    noRemote: true,
    name: 'off-copy',
    io,
  })
  assert.ok(result !== undefined)
  const imported = result.installed[0]!
  assert.equal(imported.kind, 'snapshot')
  assert.equal(imported.enabled, false)
  assert.deepEqual(
    imported.links,
    [],
    'a disabled entry must not be re-enabled on the receiving machine',
  )

  const entry = (await manifest.readManifest()).skills.find((s) => s.name === 'off-copy')
  assert.ok(entry !== undefined, 'the entry is registered under the requested name')
  assert.equal(entry!.gitUrl, '', 'a snapshot records no remote')
  assert.equal(await linker.isLinked('off-copy'), false)
})

test('--no-remote lands a labelled package as a linked snapshot under repos/', async () => {
  await clearManifest()
  const seeded = await seedSkill('snap-src')
  await addEntry({ name: 'snap-src' })
  await linker.linkSkill('snap-src', seeded)

  const out = join(work, 'snap-package.zip')
  await exporter.exportSkills({ names: ['snap-src'], out })

  await remover.removeSkill('snap-src')
  await assert.rejects(stat(paths.repoDir('snap-src')))

  const { plan, result } = await importer.importPackage({ source: out, noRemote: true, io })
  assert.deepEqual(plan.entries[0]!.decision, { kind: 'snapshot', reason: 'no-remote' })
  assert.ok(result !== undefined)
  assert.equal(result.installed[0]!.kind, 'snapshot')

  const entry = (await manifest.readManifest()).skills.find((s) => s.name === 'snap-src')
  assert.ok(entry !== undefined)
  assert.equal(manifest.hasGitSource(entry!), false, 'a snapshot has no remote to update from')
  const dir = paths.repoDir(entry!.path)
  assert.equal((await stat(join(dir, 'SKILL.md'))).isFile(), true, 'the payload arrived under repos/')
  // The link the exporting machine had is rebuilt, so the catalog is the same.
  assert.deepEqual((await linker.entryLinks(entry!)).map((l) => l.name), ['snap-src'])
})

/* ------------------------------------------------------------------ */
/* The peel scan for unlabelled packages                               */
/* ------------------------------------------------------------------ */

test('a bare package is peeled one level to skills/ and imported as a linked snapshot', async () => {
  await clearManifest()
  const source = await writeZip('bare-one-level.zip', { 'skills/alpha/SKILL.md': skillMd('alpha') })

  const plan = await planOf(source)
  assert.equal(plan.labelled, false)
  assert.equal(
    plan.candidate,
    'skills',
    'the installer rules only find alpha once the skills/ wrapper is peeled',
  )
  assert.equal(plan.peel, 1)
  assert.equal(plan.entries.length, 1)
  assert.deepEqual(plan.entries[0]!.skills.map((s) => s.name), ['alpha'])

  const { result } = await importer.importPackage({ source, io })
  assert.ok(result !== undefined)
  assert.equal(result.installed[0]!.kind, 'snapshot')
  const entry = (await manifest.readManifest()).skills.find((s) => s.name === 'bare-one-level')
  assert.ok(entry !== undefined, 'an unlabelled package is named after the file')
  assert.equal(await linker.isLinked('bare-one-level'), true)
})

test('a bare package wrapped twice is peeled to export-2026/skills', async () => {
  await clearManifest()
  const source = await writeZip('bare-two-levels.zip', {
    'export-2026/skills/alpha/SKILL.md': skillMd('alpha'),
  })

  const plan = await planOf(source)
  assert.equal(plan.candidate, 'export-2026/skills')
  assert.equal(plan.peel, 2, 'the archive wrapper and the staging directory cost one peel each')
  assert.deepEqual(plan.entries[0]!.skills.map((s) => s.name), ['alpha'])
})

test('a package whose only markdown is a note holds no skill', async () => {
  await clearManifest()
  // `notes.md` carries neither a frontmatter name nor a description, so the
  // installer's rules find nothing in it — at the package root, where nothing
  // can be nested too deep at all. The honest verdict is therefore "no skill
  // here"; reporting "too deep" sends the caller looking for a `--subdir` that
  // would not help.
  const source = await writeZip('notes-only.zip', { 'notes.md': 'just some notes\n' })

  const refusal = await refusalOf(source)
  assert.equal(refusal.code, 'no-skill-found')
})

test('skills nested deeper than the peel budget are refused and the file is named', async () => {
  await clearManifest()
  const source = await writeZip('too-deep.zip', { 'a/b/c/d/e/SKILL.md': skillMd('deep') })

  const refusal = await refusalOf(source)
  assert.equal(refusal.code, 'skill-nested-too-deep')
  // The message is part of that contract: it has to name what it found, or the
  // user cannot tell which path to hand to `--subdir`.
  assert.match(refusal.message, /a\/b\/c\/d\/e\/SKILL\.md/)
})

test('--subdir rescues a package whose skills sit below the peel budget', async () => {
  await clearManifest()
  const source = await writeZip('too-deep-subdir.zip', { 'a/b/c/d/e/SKILL.md': skillMd('deep') })

  const plan = await planOf(source, { subdir: 'a/b/c/d/e' })
  assert.equal(plan.entries.length, 1)
  assert.equal(plan.entries[0]!.root, 'a/b/c/d/e', 'the explicit root is used as given')
  assert.equal(plan.peel, 0, 'naming the root skips the peel scan entirely')
  assert.equal(plan.candidate, 'a/b/c/d/e')
  assert.deepEqual(plan.entries[0]!.skills.map((s) => s.name), ['deep'])
})

/* ------------------------------------------------------------------ */
/* Deciding before touching anything                                   */
/* ------------------------------------------------------------------ */

test('--dry-run reports a plan without touching the manifest, repos/ or the skills root', async () => {
  await clearManifest()
  const seeded = await seedSkill('untouched')
  await addEntry({ name: 'untouched' })
  await linker.linkSkill('untouched', seeded)

  const source = await writeZip('dry-run.zip', { 'skills/gamma/SKILL.md': skillMd('gamma') })

  const before = await nexusState()
  const { plan, result } = await importer.importPackage({
    source,
    dryRun: true,
    noNetCheck: true,
    io,
  })
  assert.equal(result, undefined, 'a dry run decides and stops')
  assert.ok(plan.entries.length > 0, 'the plan is still complete')
  assert.deepEqual(await nexusState(), before)
})

test('the snapshot reason is decided from the label and the remote probe', async () => {
  await clearManifest()
  // Two entries in one package: one records a remote that cannot answer, the
  // other was itself a snapshot and records no remote at all.
  await seedSkill('probe-src')
  await addEntry({ name: 'probe-src' })
  await seedSkill('sourceless')
  await addEntry({ name: 'sourceless', gitUrl: '', ref: '', commit: '' })

  const out = join(work, 'probe-package.zip')
  await exporter.exportSkills({ all: true, out })

  const reasons = async (options: PlanOptions): Promise<Map<string, ImportDecision>> => {
    const plan = await planOf(out, options)
    return new Map<string, ImportDecision>(plan.entries.map((e) => [e.name, e.decision]))
  }

  // --no-remote: land as a snapshot even though the label records a remote.
  const noRemote = await reasons({ noRemote: true })
  assert.deepEqual(noRemote.get('probe-src'), { kind: 'snapshot', reason: 'no-remote' })

  // --no-net-check: no verdict was reached, and "not checked" must never read
  // as "the repository is gone".
  const offline = await reasons({ noNetCheck: true })
  assert.deepEqual(offline.get('probe-src'), { kind: 'snapshot', reason: 'not-checked' })

  // A remote that refuses to answer is `unreachable`, never `timeout` — the two
  // are only conflated by a probe that cannot tell them apart.
  const probed = await reasons({})
  assert.deepEqual(probed.get('probe-src'), { kind: 'snapshot', reason: 'unreachable' })

  // An entry the label records without a remote has no source to try at all,
  // whatever the caller asked for.
  assert.deepEqual(probed.get('sourceless'), { kind: 'snapshot', reason: 'no-source' })
  assert.deepEqual(noRemote.get('sourceless'), { kind: 'snapshot', reason: 'no-source' })
})

/* ------------------------------------------------------------------ */
/* Conflicts and packages with nothing in them                         */
/* ------------------------------------------------------------------ */

test('importing the same package twice reports the conflict, and force replaces the entry', async () => {
  await clearManifest()
  const source = await writeZip('conflict.zip', { 'skills/conflict/SKILL.md': skillMd('conflict') })

  const first = await importer.importPackage({ source, io })
  assert.deepEqual(first.result?.failed, [])
  assert.equal(await linker.isLinked('conflict'), true)

  const second = await importer.importPackage({ source, io })
  assert.equal(second.result!.installed.length, 0)
  assert.equal(second.result!.failed.length, 1, 'one bad entry must not abort the run')
  assert.equal(second.result!.failed[0]!.name, 'conflict')
  assert.match(second.result!.failed[0]!.reason, /already registered/)
  // The refusal changed nothing: one entry, still linked.
  assert.equal(
    (await manifest.readManifest()).skills.filter((s) => s.name === 'conflict').length,
    1,
  )
  assert.equal(await linker.isLinked('conflict'), true)

  const forced = await importer.importPackage({ source, io, force: true })
  assert.deepEqual(forced.result!.failed, [])
  assert.equal(forced.result!.installed.length, 1)
  const entries = (await manifest.readManifest()).skills.filter((s) => s.name === 'conflict')
  assert.equal(entries.length, 1, '--force replaces the entry instead of duplicating it')
  // The replacement is usable: the link exists and its target holds the payload
  // (asserted through the link, so the package's internal layout stays its own
  // business — the peel scan decides where inside repos/ the skill lands).
  const [link] = await linker.entryLinks(entries[0]!)
  assert.ok(link !== undefined, 'the replacement is linked')
  assert.equal(link.name, 'conflict')
  assert.equal((await stat(join(link.target, 'SKILL.md'))).isFile(), true)
})

test('a hand-placed directory at an entry name is refused, never clobbered', async () => {
  await clearManifest()
  const source = await writeZip('collide.zip', { 'skills/collide/SKILL.md': skillMd('collide') })

  // A real directory the user put in the skills root: the import must refuse
  // the entry (409 collision on the panel side) instead of deleting it.
  const planted = join(paths.OFFICIAL_SKILLS_DIR, 'collide')
  await mkdir(planted, { recursive: true })

  const { result } = await importer.importPackage({ source, io })
  assert.equal(result!.installed.length, 0)
  assert.equal(result!.failed.length, 1)
  assert.match(result!.failed[0]!.reason, /official skills root/)

  const st = await lstat(planted)
  assert.equal(st.isSymbolicLink(), false, 'the hand-placed directory is untouched')
  assert.equal(st.isDirectory(), true)
  assert.equal((await manifest.readManifest()).skills.length, 0)
})

test('a label that lists sources but carries no payload is manifest-only', async () => {
  await clearManifest()
  const source = await writeZip('manifest-only.zip', {
    [exporter.PACKAGE_MANIFEST]: labelWith([{ name: 'ghost' }]),
  })

  const plan = await planOf(source)
  assert.equal(plan.labelled, true)
  assert.equal(plan.manifestOnly, true, 'a label without payload is not a package to import')
  assert.equal(plan.files, 0)

  await assert.rejects(importer.importPackage({ source, io }), (err: unknown) => {
    assert.ok(err instanceof importer.ImportError, `expected an ImportError, got ${String(err)}`)
    assert.equal(err.code, 'nothing-to-import')
    return true
  })
})

test('--each plans one entry per skill instead of one per candidate root', async () => {
  await clearManifest()
  const source = await writeZip('two-skills.zip', {
    'skills/alpha/SKILL.md': skillMd('alpha'),
    'skills/beta/SKILL.md': skillMd('beta'),
  })

  const together = await planOf(source)
  assert.equal(together.entries.length, 1)
  assert.deepEqual(together.entries[0]!.skills.map((s) => s.name), ['alpha', 'beta'])

  const each = await planOf(source, { each: true })
  assert.deepEqual(each.entries.map((e) => e.name), ['alpha', 'beta'])
  assert.deepEqual(each.entries.map((e) => e.root), ['skills/alpha', 'skills/beta'])
  assert.deepEqual(each.entries.map((e) => e.skills.length), [1, 1])
})

/* ------------------------------------------------------------------ */
/* CLI surface                                                         */
/* ------------------------------------------------------------------ */

test('import usage errors exit 2 and write nothing', async () => {
  const cases: string[][] = [[], ['--bogus'], ['alpha.zip', 'beta.zip']]
  for (const argv of cases) {
    const { io: cliIo, lines } = captureIO()
    assert.equal(await cli.importCommand(argv, cliIo), 2, `argv: ${argv.join(' ')}`)
    assert.deepEqual(lines, [], 'a usage error emits nothing on stdout')
  }
})

test('a --dry-run exits 0 and reports the snapshot verdict', async () => {
  await clearManifest()
  const source = await writeZip('cli-dry-run.zip', { 'skills/alpha/SKILL.md': skillMd('alpha') })

  const { io: cliIo, lines } = captureIO()
  assert.equal(await cli.importCommand([source, '--dry-run'], cliIo), 0)
  assert.match(
    lines.join(''),
    /will import as snapshot/,
    'an unlabelled package has no source to clone from',
  )
  // A plan is not a registration.
  assert.equal((await manifest.readManifest()).skills.length, 0)
})

test('importing a missing package exits 1', async () => {
  const { io: cliIo } = captureIO()
  assert.equal(await cli.importCommand([join(work, 'no-such-package.zip')], cliIo), 1)
})

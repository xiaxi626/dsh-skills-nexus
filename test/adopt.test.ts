import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { parseAdoptArgs } from '../src/cli/args.js'
import type { SkillEntry } from '../src/types.js'
import type { AdoptError, AdoptOptions } from '../src/adopt.js'
import type { OpsIO } from '../src/ops-io.js'
import { removeTree } from './fs-helpers.js'

/**
 * Module-level tests for the `adopt` core 鈥?channel D of the sources &
 * packages design (`docs/sources-and-packages.md`).
 *
 * The promise under test is that a frozen entry can be given an identity
 * without becoming a different entry: it keeps its name and its `path`, its
 * clone is rebuilt from the repository the user names, and `update` /
 * `switch-version` work on it afterwards. Two guards protect the catalog while
 * that happens: a source that yields a *different* skill set is refused unless
 * `--force` says otherwise, and a failure at any step puts the directory, the
 * links and the manifest back exactly as they were 鈥?the 搂9 invariant.
 *
 * `paths.ts` reads `DSH_HOME` at import time, so the env var is set in
 * `before()` before the first import of the manifest鈫抪aths chain (same pattern
 * as import.test.ts). Every remote fixture is a local `file://` path, so the
 * suite never needs the network.
 */

const execFileAsync = promisify(execFile)

let home: string
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let linker: typeof import('../src/link.js')
let adopter: typeof import('../src/adopt.js')
let installer: typeof import('../src/install.js')
let gitMod: typeof import('../src/git.js')
let cli: typeof import('../src/cli/commands/adopt.js')

/** Silent OpsIO for the core tests; CLI tests capture their own lines. */
const io: OpsIO = {
  confirm: async () => true,
  progress: () => {},
  emit: () => {},
  error: () => {},
  interactive: false,
}

/**
 * The OpsIO seam, so CLI tests never patch process.stdout. `lines` is the
 * batch output (`emit`) and `errors` the diagnostics (`error`) 鈥?kept apart
 * because A1's whole point is that a machine consumer reads one stream and a
 * human the other.
 */
function captureIO(): { io: OpsIO; lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return {
    lines,
    errors,
    io: {
      confirm: async () => true,
      progress: () => {},
      emit: (line: string) => {
        lines.push(line)
      },
      error: (line: string) => {
        errors.push(line)
      },
      interactive: false,
    },
  }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-adopt-home-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  // `link`, `install` and the command modules must arrive through the same
  // dynamic chain: a *static* import of src/link.ts would evaluate paths.ts
  // while the module graph loads 鈥?before DSH_HOME is repointed 鈥?so every
  // symlink write would land in the real ~/.dsh.
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  linker = await import('../src/link.js')
  adopter = await import('../src/adopt.js')
  installer = await import('../src/install.js')
  gitMod = await import('../src/git.js')
  cli = await import('../src/cli/commands/adopt.js')
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

/** A blank nexus: no manifest, no repos/, no links. */
async function resetNexus(): Promise<void> {
  for (const entry of (await manifest.readManifest()).skills) {
    await manifest.removeEntry(entry.name)
  }
  await rm(paths.REPOS_DIR, { recursive: true, force: true })
  await removeTree(paths.OFFICIAL_SKILLS_DIR)
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

/** Create an entry's directory under <repos> with the given payload. */
async function seedSkill(name: string, files?: Record<string, string>): Promise<string> {
  const root = paths.repoDir(name)
  await writeFiles(root, files ?? { 'SKILL.md': skillMd(name) })
  return root
}

/** `file://` URL of a directory 鈥?the only remote shape this suite uses. */
function fileUrl(dir: string): string {
  return 'file:///' + dir.replaceAll('\\', '/')
}

async function addEntry(overrides: Partial<SkillEntry> & { name: string }): Promise<void> {
  await manifest.addEntry({
    url: `package:fixture`,
    gitUrl: '',
    ref: '',
    commit: '',
    path: overrides.name,
    addedAt: new Date().toISOString(),
    ...overrides,
  })
}

const git = async (dir: string, args: string[]): Promise<void> => {
  await execFileAsync('git', args, { cwd: dir })
}

/** Create a source repo with one commit on `main` (the update.test.ts shape). */
async function makeRepo(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFiles(dir, files)
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'initial'])
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readTextOrMissing(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return '<missing>'
  }
}

/**
 * A recursive listing of a directory's paths and file contents. Compared
 * verbatim before and after a refused or rolled-back adopt, so an unexpected
 * *extra* or *missing* file is caught too 鈥?not just a changed one. `.git` is
 * recorded as a directory but not descended into (its internals are not what
 * the invariant is about).
 */
async function treeSnapshot(root: string): Promise<string> {
  if (!(await exists(root))) return '<missing>'
  const out: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const dirent of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, dirent.name)
      const rel = relative(root, abs).replaceAll('\\', '/')
      if (dirent.isDirectory()) {
        out[rel] = '<dir>'
        if (dirent.name !== '.git') await walk(abs)
      } else if (dirent.isFile()) {
        out[rel] = await readFile(abs, 'utf8')
      } else {
        out[rel] = '<other>'
      }
    }
  }
  await walk(root)
  return JSON.stringify(out)
}

/**
 * Everything an adopt could disturb (搂9): the manifest bytes, the entry's
 * directory tree, and the links that point into it. Nothing else is compared 鈥? * a *new* link set is the feature, not a leak.
 */
async function stateOf(name: string): Promise<{ manifest: string; dir: string; links: string }> {
  const entry = (await manifest.readManifest()).skills.find((s) => s.name === name)
  const links = entry === undefined ? [] : await linker.entryLinks(entry)
  return {
    manifest: await readTextOrMissing(paths.MANIFEST_PATH),
    dir: await treeSnapshot(entry === undefined ? join(paths.REPOS_DIR, name) : paths.repoDir(entry.path)),
    links: links
      .map((l) => `${l.name} -> ${l.target}`)
      .sort()
      .join('\n'),
  }
}

async function reposNames(): Promise<string[]> {
  try {
    return (await readdir(paths.REPOS_DIR)).sort()
  } catch {
    return []
  }
}

/** Staging directories that outlived their adopt 鈥?they never may. */
async function stageResidue(): Promise<string[]> {
  return (await reposNames()).filter((n) => n.startsWith('.adopt-stage'))
}

/** Pre-adopt backups 鈥?expected after a successful adopt, never after a failure. */
async function backupResidue(): Promise<string[]> {
  return (await reposNames()).filter((n) => n.includes('.pre-adopt'))
}

/** The graded refusal an adopt produces; `code` is the contract. */
async function refusalOf(
  options: Partial<AdoptOptions> & { name: string; url: string },
): Promise<AdoptError> {
  try {
    await adopter.adoptSkill({ ...options, io })
  } catch (err) {
    assert.ok(err instanceof adopter.AdoptError, `expected an AdoptError, got ${String(err)}`)
    return err
  }
  assert.fail('the adopt was accepted; it has to be refused')
}

async function entryOf(name: string): Promise<SkillEntry> {
  const entry = (await manifest.readManifest()).skills.find((s) => s.name === name)
  assert.ok(entry !== undefined, `entry "${name}" should be registered`)
  return entry
}

/* ------------------------------------------------------------------ */
/* parseAdoptArgs 鈥?name, source, modifiers                            */
/* ------------------------------------------------------------------ */

test('parseAdoptArgs keeps the entry name, the source and the modifiers apart', () => {
  assert.deepEqual(parseAdoptArgs(['solo', '--url', 'owner/repo']), {
    name: 'solo',
    url: 'owner/repo',
    force: false,
    prune: false,
  })
  assert.deepEqual(parseAdoptArgs(['--force', 'solo', '--url=owner/repo#dev', '--prune']), {
    name: 'solo',
    url: 'owner/repo#dev',
    force: true,
    prune: true,
  })
  assert.deepEqual(parseAdoptArgs(['solo', '--url', 'u', '--ref', 'v2', '--subdir', 'skills/foo']), {
    name: 'solo',
    url: 'u',
    ref: 'v2',
    subdir: 'skills/foo',
    force: false,
    prune: false,
  })
  // A value may itself contain `=`; only the first one splits.
  assert.equal(parseAdoptArgs(['solo', '--url=a=b']).url, 'a=b')
})

test('parseAdoptArgs rejects what it cannot mean', () => {
  assert.throws(() => parseAdoptArgs([]), /missing skill name/)
  assert.throws(() => parseAdoptArgs(['solo']), /--url is required/)
  assert.throws(() => parseAdoptArgs(['--prune', 'solo']), /--url is required/)
  assert.throws(() => parseAdoptArgs(['a', 'b', '--url', 'u']), /one entry name at a time/)
  assert.throws(() => parseAdoptArgs(['solo', '--url', 'u', '--bogus']), /unknown argument/)
  assert.throws(() => parseAdoptArgs(['solo', '--url', 'u', '--force=1']), /takes no value/)
  assert.throws(() => parseAdoptArgs(['solo', '--url', 'u', '--prune=yes']), /takes no value/)
  assert.throws(() => parseAdoptArgs(['solo', '--url']), /--url requires/)
  assert.throws(() => parseAdoptArgs(['solo', '--url=']), /--url requires/)
  assert.throws(() => parseAdoptArgs(['solo', '--url', 'u', '--ref']), /--ref requires/)
  assert.throws(() => parseAdoptArgs(['solo', '--url', 'u', '--subdir']), /--subdir requires/)
})

/* ------------------------------------------------------------------ */
/* The promise 鈥?a frozen entry becomes an updatable one                */
/* ------------------------------------------------------------------ */

test('adopt re-sources a snapshot from its real repository and rebuilds the links', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-adopt')
  await makeRepo(remoteDir, {
    // Upstream frontmatter the official provider would reject, and no
    // description: adopting has to normalize exactly like an install does.
    'SKILL.md': '---\nname: Adopted_Skill\n---\n\nBody from the real repository.\n',
  })
  const remote = fileUrl(remoteDir)
  const head = await gitMod.getHeadCommit(remoteDir)

  const seeded = await seedSkill('adopted', { 'SKILL.md': skillMd('adopted') })
  // The frozen entry a package import or a handed-over directory would have
  // left: no remote, so nothing to fetch and nothing to switch.
  await addEntry({ name: 'adopted', commit: '' })
  await linker.linkSkill('adopted', seeded)

  const result = await adopter.adoptSkill({ name: 'adopted', url: remote, io })

  assert.equal(result.url, remote)
  assert.equal(result.gitUrl, remote)
  assert.equal(result.ref, 'main')
  assert.equal(result.commit, head)
  assert.equal(result.subdir, undefined)
  assert.equal(result.wasEnabled, true)
  assert.deepEqual(result.skills, ['adopted'])
  assert.deepEqual(result.links, ['adopted'])
  assert.equal(result.pruned, false)
  assert.ok(result.backup !== undefined, 'the previous directory is kept unless --prune says otherwise')
  assert.equal(result.normalized, 2, 'an invalid name and a missing description are both fixed')

  const entry = await entryOf('adopted')
  assert.equal(manifest.hasGitSource(entry), true)
  assert.equal(entry.commit, head, 'the commit is the lockfile-lite')
  assert.ok(entry.updatedAt !== undefined)

  const clone = paths.repoDir('adopted')
  assert.equal((await stat(join(clone, '.git'))).isDirectory(), true, 'a real clone, not a copy')
  const landed = await readFile(join(clone, 'SKILL.md'), 'utf8')
  assert.match(landed, /name: adopted-skill/, 'the frontmatter name is normalized on the way in')
  assert.match(landed, /description: "adopted-skill"/, 'the missing description is filled in')
  assert.match(landed, /Body from the real repository/, 'the raw upstream file landed')
  assert.doesNotMatch(landed, /Body of adopted/, 'the snapshot is gone from the live path')
  assert.match(
    await readFile(join(result.backup!, 'SKILL.md'), 'utf8'),
    /Body of adopted/,
    'and it is what the backup holds',
  )
  assert.deepEqual((await linker.entryLinks(entry)).map((l) => l.name), ['adopted'])
})

test('--prune deletes the backup instead of reporting it', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-prune')
  await makeRepo(remoteDir, { 'SKILL.md': skillMd('pruned') })
  const seeded = await seedSkill('pruned')
  await addEntry({ name: 'pruned' })
  await linker.linkSkill('pruned', seeded)

  const result = await adopter.adoptSkill({ name: 'pruned', url: fileUrl(remoteDir), io, prune: true })

  assert.equal(result.pruned, true)
  assert.equal(result.backup, undefined, 'a pruned backup is not reported as kept')
  assert.deepEqual(await backupResidue(), [])
  assert.equal(await exists(seeded), true, 'the live directory is the clone now, not the snapshot')
  assert.match(await readFile(join(seeded, 'SKILL.md'), 'utf8'), /pruned skill/)
})

test('an entry with no directory at all is adopted, and stays disabled', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-orphan')
  await makeRepo(remoteDir, { 'SKILL.md': skillMd('orphan') })
  // A manifest entry whose clone is gone (doctor's missing-target): there is
  // nothing to compare against and nothing to back up, but adopting it is the
  // repair 鈥?the entry gets a real clone again.
  await addEntry({ name: 'orphan' })

  const result = await adopter.adoptSkill({ name: 'orphan', url: fileUrl(remoteDir), io })

  assert.equal(result.wasEnabled, false)
  assert.deepEqual(result.links, [], 'an entry that was not linked must not be linked by adopting')
  assert.deepEqual(result.skills, ['orphan'])
  assert.equal(result.backup, undefined, 'nothing existed to keep')
  assert.equal(result.pruned, false)
  assert.equal(await linker.isLinked('orphan'), false)
  assert.deepEqual(await backupResidue(), [])
  const entry = await entryOf('orphan')
  assert.equal(manifest.hasGitSource(entry), true)
  assert.equal((await stat(join(paths.repoDir('orphan'), '.git'))).isDirectory(), true)
})

test('--force re-sources an entry that already has a git source', async () => {
  await resetNexus()
  const first = join(home, 'remote-first')
  await makeRepo(first, { 'SKILL.md': skillMd('reso'), 'MARKER.txt': 'from the first repo\n' })
  const second = join(home, 'remote-second')
  await makeRepo(second, { 'SKILL.md': skillMd('reso') })
  const head2 = await gitMod.getHeadCommit(second)

  const installed = await installer.installFromGit({
    spec: fileUrl(first),
    gitSpec: gitMod.parseGitSpec(fileUrl(first)),
    subdir: undefined,
    skillName: 'reso',
    path: 'reso',
    name: undefined,
    subdirLeaf: undefined,
    yes: true,
    io,
  })
  assert.equal(installed.status, 'installed')

  // Without --force the precondition holds: this entry does not need adopting.
  const refusal = await refusalOf({ name: 'reso', url: fileUrl(second) })
  assert.equal(refusal.code, 'already-has-source')
  assert.match(refusal.message, /--force/)

  const result = await adopter.adoptSkill({ name: 'reso', url: fileUrl(second), io, force: true, prune: true })

  assert.equal(result.gitUrl, fileUrl(second))
  assert.equal(result.commit, head2)
  const entry = await entryOf('reso')
  assert.equal(entry.gitUrl, fileUrl(second))
  assert.equal(
    await exists(join(paths.repoDir('reso'), 'MARKER.txt')),
    false,
    'the previous clone was replaced, not merged into',
  )
  assert.deepEqual((await linker.entryLinks(entry)).map((l) => l.name), ['reso'])
})

/* ------------------------------------------------------------------ */
/* The discovery guard                                                 */
/* ------------------------------------------------------------------ */

test('a source that yields different skills is refused, and --force adopts it anyway', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-narrow')
  await makeRepo(remoteDir, { 'SKILL.md': skillMd('only-one') })
  const remote = fileUrl(remoteDir)

  // Two skills today, one from the new source: adopting would silently drop a
  // skill from the catalog, which is exactly what the guard is for.
  const seeded = await seedSkill('pair', {
    'alpha/SKILL.md': skillMd('alpha'),
    'beta/SKILL.md': skillMd('beta'),
  })
  await addEntry({ name: 'pair' })
  await linker.linkSkill('alpha', join(seeded, 'alpha'))
  await linker.linkSkill('beta', join(seeded, 'beta'))

  const before = await stateOf('pair')
  const refusal = await refusalOf({ name: 'pair', url: remote })
  assert.equal(refusal.code, 'skill-mismatch')
  // The message has to name both sides, or the user cannot tell whether the
  // URL is wrong or the repository changed.
  assert.match(refusal.message, /alpha, beta/)
  assert.match(refusal.message, /pair/)
  assert.deepEqual(await stateOf('pair'), before)
  assert.deepEqual(await stageResidue(), [])

  const forced = await adopter.adoptSkill({ name: 'pair', url: remote, io, force: true })
  assert.deepEqual(forced.skills, ['pair'])
  assert.deepEqual(forced.links, ['pair'])
  const entry = await entryOf('pair')
  assert.equal(manifest.hasGitSource(entry), true)
  assert.deepEqual(
    (await linker.entryLinks(entry)).map((l) => l.name),
    ['pair'],
    'the old link set is dropped, the new one takes its place',
  )
})

test('--subdir defaults to the recorded root, and an explicit one replaces it', async () => {
  await resetNexus()
  const nested = join(home, 'remote-nested')
  await makeRepo(nested, { 'skills/alpha/SKILL.md': skillMd('alpha'), 'README.md': 'docs\n' })
  const seeded = await seedSkill('nested-alpha', { 'skills/alpha/SKILL.md': skillMd('alpha') })
  await addEntry({ name: 'nested-alpha', subdir: 'skills/alpha' })
  await linker.linkSkill('nested-alpha', join(seeded, 'skills', 'alpha'))

  const inherited = await adopter.adoptSkill({ name: 'nested-alpha', url: fileUrl(nested), io })
  assert.equal(inherited.subdir, 'skills/alpha', 'the skill root is part of the entry identity')
  const entry = await entryOf('nested-alpha')
  assert.equal(entry.subdir, 'skills/alpha')
  const clone = paths.repoDir('nested-alpha')
  assert.equal((await stat(join(clone, 'skills', 'alpha', 'SKILL.md'))).isFile(), true)
  const [link] = await linker.entryLinks(entry)
  assert.ok(link !== undefined)
  assert.equal(await realpath(link.target), await realpath(join(clone, 'skills', 'alpha')), 'the link points at the subdir')

  // `--subdir .` is the clone root 鈥?the manifest records that as "no subdir".
  const root = join(home, 'remote-root')
  await makeRepo(root, { 'SKILL.md': skillMd('root-skill') })
  const overridden = await adopter.adoptSkill({
    name: 'nested-alpha',
    url: fileUrl(root),
    io,
    force: true,
    subdir: '.',
  })
  assert.equal(overridden.subdir, undefined)
  const after = await entryOf('nested-alpha')
  assert.equal(after.subdir, undefined)
  assert.equal((await stat(join(paths.repoDir('nested-alpha'), 'SKILL.md'))).isFile(), true)
})

/* ------------------------------------------------------------------ */
/* Failures leave nothing behind                                       */
/* ------------------------------------------------------------------ */

test('a clone that cannot be made leaves the entry untouched', async () => {
  await resetNexus()
  const seeded = await seedSkill('unreachable-target')
  await addEntry({ name: 'unreachable-target' })
  await linker.linkSkill('unreachable-target', seeded)

  const before = await stateOf('unreachable-target')
  const refusal = await refusalOf({
    name: 'unreachable-target',
    url: fileUrl(join(home, 'no-such-repository')),
  })

  assert.equal(refusal.code, 'clone-failed')
  assert.deepEqual(await stateOf('unreachable-target'), before)
  assert.deepEqual(await stageResidue(), [])
  assert.deepEqual(await backupResidue(), [])
  assert.deepEqual((await manifest.readManifest()).skills.map((s) => s.gitUrl), [''])
})

test('a failure after the swap restores the directory, the links and the manifest', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-rollback')
  await makeRepo(remoteDir, { 'SKILL.md': skillMd('rolled') })
  const seeded = await seedSkill('rolled', {
    'SKILL.md': skillMd('rolled'),
    'references/notes.txt': 'snapshot payload\n',
  })
  await addEntry({ name: 'rolled' })
  await linker.linkSkill('rolled', seeded)
  const before = await stateOf('rolled')

  // Force a late failure: `writeManifest` writes `<manifest>.tmp` and renames it
  // over the live file, so a directory sitting at that path makes the write
  // itself fail. That is the failure mode the rollback exists for 鈥?the fresh
  // clone has already replaced the directory by then.
  const tmp = `${paths.MANIFEST_PATH}.tmp`
  await mkdir(tmp)
  try {
    const failure = await refusalOf({ name: 'rolled', url: fileUrl(remoteDir) })
    assert.equal(failure.code, 'adopt-failed')
    assert.match(failure.message, /nothing was changed/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }

  assert.deepEqual(await stateOf('rolled'), before)
  assert.deepEqual(await stageResidue(), [])
  assert.deepEqual(await backupResidue(), [], 'the backup was moved back, not left beside the clone')
  const entry = await entryOf('rolled')
  assert.equal(manifest.hasGitSource(entry), false, 'the manifest still describes a snapshot')
})

test('adopt refuses what it cannot do, before touching anything', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-refusals')
  await makeRepo(remoteDir, { 'SKILL.md': skillMd('refuse') })
  const remote = fileUrl(remoteDir)
  await addEntry({ name: 'sourced', gitUrl: fileUrl(join(home, 'elsewhere')), ref: 'main', commit: 'abc1234' })

  const unknown = await refusalOf({ name: 'nope', url: remote })
  assert.equal(unknown.code, 'skill-not-found')

  // An `ownership: 'external'` entry only links a directory the user owns:
  // 搂2.1's hard invariant (external 鈬?no gitUrl) exists so nexus never touches
  // it, and adopting one would have to replace it.
  await addEntry({ name: 'planted', ownership: 'external' })
  const external = await refusalOf({ name: 'planted', url: remote })
  assert.equal(external.code, 'external-entry')
  assert.match(external.message, /must not touch/)

  assert.equal((await refusalOf({ name: 'sourced', url: '   ', force: true })).code, 'invalid-url')
  assert.equal(
    (await refusalOf({ name: 'sourced', url: 'ext::sh -c whoami', force: true })).code,
    'invalid-url',
  )
  assert.equal(
    (await refusalOf({ name: 'sourced', url: remote, force: true, subdir: '../escape' })).code,
    'invalid-subdir',
  )

  // None of the refusals wrote anything.
  assert.deepEqual(await stageResidue(), [])
  assert.deepEqual(await backupResidue(), [])
  assert.deepEqual(
    (await manifest.readManifest()).skills.map((s) => s.gitUrl),
    [fileUrl(join(home, 'elsewhere')), ''],
  )
})

/* ------------------------------------------------------------------ */
/* CLI surface                                                         */
/* ------------------------------------------------------------------ */

test('adopt usage errors exit 2 and write nothing', async () => {
  const cases: string[][] = [
    [],
    ['solo'],
    ['solo', '--url'],
    ['a', 'b', '--url', 'u'],
    ['solo', '--url', 'u', '--bogus'],
    ['solo', '--url', 'u', '--force=1'],
  ]
  for (const argv of cases) {
    const { io: cliIo, lines } = captureIO()
    assert.equal(await cli.adopt(argv, cliIo), 2, `argv: ${argv.join(' ')}`)
    assert.deepEqual(lines, [], 'a usage error emits nothing on stdout')
  }
})

test('adopt exits 0 on success and 1 when the core refuses', async () => {
  await resetNexus()
  const remoteDir = join(home, 'remote-cli')
  await makeRepo(remoteDir, { 'SKILL.md': skillMd('cli-adopt') })
  const seeded = await seedSkill('cli-adopt')
  await addEntry({ name: 'cli-adopt' })
  await linker.linkSkill('cli-adopt', seeded)

  const ok = captureIO()
  assert.equal(await cli.adopt(['cli-adopt', '--url', fileUrl(remoteDir), '--prune'], ok.io), 0)
  const text = ok.lines.join('')
  assert.match(text, /Adopted skill "cli-adopt"/)
  assert.match(text, /updatable/)
  assert.match(text, /removed \(--prune\)/)

  const missing = captureIO()
  assert.equal(await cli.adopt(['no-such-entry', '--url', fileUrl(remoteDir)], missing.io), 1)
  assert.deepEqual(missing.lines, [], 'a refusal writes nothing to stdout')

  const broken = captureIO()
  assert.equal(
    await cli.adopt(['no-such-entry', '--url', fileUrl(join(home, 'nowhere'))], broken.io),
    1,
  )
})

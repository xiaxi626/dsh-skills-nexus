import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cloneRepo, getCurrentBranch, getHeadCommit, parseGitSpec } from '../src/git.js'
import type { OpsIO } from '../src/ops-io.js'

/**
 * End-to-end tests for `switch-version` (§8.2) against local `file://`
 * remotes (no network) — both the core orchestration
 * (`src/switch-version.ts`) and the CLI wrapper
 * (`src/cli/commands/switch-version.ts`).
 *
 * The fixtures deliberately use the same `--depth 1` clones `add` produces:
 * a shallow clone holds no other refs, so every switch to a branch/tag the
 * clone has never seen exercises the fetch-first design (the bug the v1
 * design missed — `git checkout <tag>` fails without step 2). Several tests
 * also pin the exact "nothing changed" guarantees of §8.2 step 3 (a missing
 * ref must not mutate the clone, the manifest or the links).
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the switch-version→manifest→paths chain
 * (test/update.test.ts pattern). The git primitives are safe to import
 * statically: `git.ts` never touches `paths.ts`.
 */

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ */
/* Fixture helpers                                                     */
/* ------------------------------------------------------------------ */

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(join(dir, file), content, 'utf8')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', message])
}

/** SKILL.md-style content; omit the description to exercise normalization. */
function skillContent(name: string, body: string, description?: string): string {
  const desc = description === undefined ? '' : `description: ${description}\n`
  return `---\nname: ${name}\n${desc}---\n${body}\n`
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

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

let home: string
let core: typeof import('../src/switch-version.js')
let cli: typeof import('../src/cli/commands/switch-version.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-switch-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  core = await import('../src/switch-version.js')
  cli = await import('../src/cli/commands/switch-version.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** Collecting OpsIO — no stdout/stderr, records how the core reported. */
interface TestIO extends OpsIO {
  emitted: string[]
  stages: string[]
  errors: string[]
}

function makeIO(): TestIO {
  const emitted: string[] = []
  const stages: string[] = []
  const errors: string[] = []
  return {
    emitted,
    stages,
    errors,
    confirm: async () => false,
    progress: (stage, detail) => {
      stages.push(detail ? `${stage}: ${detail}` : stage)
    },
    emit: (line) => {
      emitted.push(line)
    },
    error: (line) => {
      errors.push(line)
    },
    interactive: false,
  }
}

/**
 * Run `cmd` and read the diagnostics it produced.
 *
 * These used to monkey-patch `process.stderr.write`, because that is where the
 * wrapper wrote. A1 collected every CLI diagnostic into the `OpsIO` seam
 * (`io.error`), so there is nothing left to patch: the test's own `io` is the
 * capture. Reading the seam instead of a global stream is also strictly
 * stronger — it fails if a future call site *bypasses* `io.error`, which the
 * patch could never notice.
 */
async function captureErrors(
  io: TestIO,
  cmd: () => Promise<number>,
): Promise<{ code: number; err: string }> {
  const code = await cmd()
  return { code, err: io.errors.join('\n') === '' ? '' : `${io.errors.join('\n')}\n` }
}

/** Clone `src#ref` into `repos/<name>` exactly as `add` would. */
async function cloneEntry(name: string, src: string, ref: string): Promise<string> {
  const dest = paths.repoDir(name)
  await cloneRepo(parseGitSpec(`${fileUrl(src)}#${ref}`), dest)
  return dest
}

/** Register a git-sourced entry mirroring `add`'s manifest shape. */
async function register(name: string, src: string, ref: string, commit: string): Promise<void> {
  await manifest.addEntry({
    name,
    url: fileUrl(src),
    gitUrl: fileUrl(src),
    ref,
    commit,
    path: name,
    addedAt: new Date().toISOString(),
  })
}

async function entryOf(name: string) {
  const m = await manifest.readManifest()
  return m.skills.find((s) => s.name === name)!
}

/* ------------------------------------------------------------------ */
/* Core — the §8.2 flow                                                */
/* ------------------------------------------------------------------ */

test('switching branch → tag pins the clone; switching back re-attaches the branch', async () => {
  const src = join(home, 'src-tagged')
  await initRepo(src)
  // v1 has no frontmatter description → the post-checkout re-normalize step
  // must fill it in (raw upstream files are restored by the checkout).
  await commitFile(src, 'SKILL.md', skillContent('s1', '# s1'), 'v1')
  await git(src, ['tag', 'v1.0.0'])
  const pinnedSha = await getHeadCommit(src)
  await commitFile(src, 'SKILL.md', skillContent('s1', '# s1 v2', 'second'), 'v2')
  const branchSha = await getHeadCommit(src)

  const name = 'tagged'
  const dest = await cloneEntry(name, src, 'main')
  await register(name, src, 'main', branchSha)
  await link.linkSkill(name, dest)

  // A --depth 1 clone holds no other refs — the tag is absent before the
  // fetch step, which is exactly why `switch-version` fetches first.
  await assert.rejects(execFileAsync('git', ['rev-parse', 'v1.0.0'], { cwd: dest }))
  assert.equal(await getHeadCommit(dest), branchSha)

  const io = makeIO()
  const first = await core.switchVersion(name, 'v1.0.0', undefined, io)
  assert.equal(first.kind, 'pin')
  assert.equal(first.before, branchSha)
  assert.equal(first.after, pinnedSha)
  assert.equal(first.wasDirty, false)
  assert.deepEqual(first.links, [name])
  assert.equal(await getHeadCommit(dest), pinnedSha)
  assert.equal(await getCurrentBranch(dest), undefined, 'a tag pin leaves the clone detached')
  assert.deepEqual(io.stages, ['fetching: v1.0.0'])
  assert.match(await readFile(join(dest, 'SKILL.md'), 'utf8'), /description/)

  let entry = await entryOf(name)
  assert.equal(entry.ref, 'v1.0.0')
  assert.equal(entry.commit, pinnedSha)
  assert.equal(await link.isLinked(name), true)

  // Back to the branch: HEAD re-attaches and tracks origin/main again.
  const second = await core.switchVersion(name, 'main', undefined, io)
  assert.equal(second.kind, 'branch')
  assert.equal(second.before, pinnedSha)
  assert.equal(second.after, branchSha)
  // The pin's re-normalization dirtied the worktree — the second switch
  // discards it (and says so) rather than refusing to check out.
  assert.equal(second.wasDirty, true)
  assert.deepEqual(io.emitted, ['  ⚠ discarding local changes in nexus-managed clone\n'])
  assert.equal(await getCurrentBranch(dest), 'main')
  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'main@{u}'], { cwd: dest })
  assert.equal(stdout.trim(), 'origin/main')
  assert.equal(await getHeadCommit(dest), branchSha)
  assert.match(await readFile(join(dest, 'SKILL.md'), 'utf8'), /second/)
  assert.deepEqual(io.stages, ['fetching: v1.0.0', 'fetching: main'])

  entry = await entryOf(name)
  assert.equal(entry.ref, 'main')
  assert.equal(entry.commit, branchSha)
  assert.equal(await link.isLinked(name), true)
})

test('switching to a raw commit sha pins the clone to that commit', async () => {
  const src = join(home, 'src-sha')
  await initRepo(src)
  // The third fetch fallback asks the server for a bare SHA — allowed only
  // with this config (the same requirement the CLI documents for servers).
  await git(src, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])
  await commitFile(src, 'SKILL.md', skillContent('s3', '# v1', 'd1'), 'v1')
  const firstSha = await getHeadCommit(src)
  await commitFile(src, 'SKILL.md', skillContent('s3', '# v2', 'd2'), 'v2')
  await commitFile(src, 'SKILL.md', skillContent('s3', '# v3', 'd3'), 'v3')
  const headSha = await getHeadCommit(src)

  const name = 'sha-skill'
  const dest = await cloneEntry(name, src, 'main')
  await register(name, src, 'main', headSha)
  await link.linkSkill(name, dest)

  const res = await core.switchVersion(name, firstSha, undefined, makeIO())
  assert.equal(res.kind, 'pin')
  assert.equal(res.before, headSha)
  assert.equal(res.after, firstSha)
  assert.equal(await getHeadCommit(dest), firstSha)
  assert.equal(await getCurrentBranch(dest), undefined)

  const entry = await entryOf(name)
  assert.equal(entry.commit, firstSha)
  assert.equal(entry.ref, firstSha, 'ref records exactly what was requested')
})

test('an unknown ref rejects with RefNotFoundError and leaves everything untouched', async () => {
  const src = join(home, 'src-unknown-ref')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', skillContent('s4', '# v1', 'd'), 'v1')
  const sha = await getHeadCommit(src)

  const name = 'nf-skill'
  const dest = await cloneEntry(name, src, 'main')
  await register(name, src, 'main', sha)
  await link.linkSkill(name, dest)

  const io = makeIO()
  await assert.rejects(
    core.switchVersion(name, 'no-such-ref', undefined, io),
    /Ref "no-such-ref" was not found — nothing was changed\./,
  )

  assert.equal(await getHeadCommit(dest), sha)
  assert.equal(await getCurrentBranch(dest), 'main')
  const entry = await entryOf(name)
  assert.equal(entry.ref, 'main')
  assert.equal(entry.commit, sha)
  assert.equal(await link.isLinked(name), true)
  assert.deepEqual(io.emitted, [], 'no discard warning — resolution happens before any mutation')
})

test('an unknown skill name rejects with SkillNotFoundError', async () => {
  await assert.rejects(
    core.switchVersion('ghost-skill', 'main', undefined, makeIO()),
    (err: unknown) => {
      assert.ok(err instanceof core.SkillNotFoundError)
      assert.equal(err.skillName, 'ghost-skill')
      return true
    },
  )
})

test('an entry with no git source rejects with NotAGitCloneError', async () => {
  await manifest.addEntry({
    name: 'source-less',
    url: 'package:z.zip',
    gitUrl: '',
    ref: '',
    commit: '',
    path: 'source-less',
    addedAt: new Date().toISOString(),
  })
  await assert.rejects(
    core.switchVersion('source-less', 'main', undefined, makeIO()),
    (err: unknown) => {
      assert.ok(err instanceof core.NotAGitCloneError)
      assert.equal(err.skillName, 'source-less')
      return true
    },
  )
})

test('a disabled entry switches but stays disabled — no links are rebuilt', async () => {
  const src = join(home, 'src-disabled')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', skillContent('s5', '# v1', 'd1'), 'v1')
  const pinnedSha = await getHeadCommit(src)
  await git(src, ['tag', 'v1.0.0'])
  await commitFile(src, 'SKILL.md', skillContent('s5', '# v2', 'd2'), 'v2')
  const branchSha = await getHeadCommit(src)

  const name = 'disabled-skill'
  const dest = await cloneEntry(name, src, 'main')
  await register(name, src, 'main', branchSha)
  // Intentionally no linkSkill call: the entry is disabled.

  const res = await core.switchVersion(name, 'v1.0.0', undefined, makeIO())
  assert.deepEqual(res.links, [], 'a disabled entry must not be silently re-enabled')
  assert.equal(res.before, branchSha)
  assert.equal(res.after, pinnedSha)
  assert.equal(await getHeadCommit(dest), pinnedSha)
  assert.equal(await link.isLinked(name), false)
})

test('a multi-skill rebuild replaces the entry-named link with per-skill links', async () => {
  const src = join(home, 'src-multi')
  await initRepo(src)
  await commitFile(src, 'solo.md', skillContent('solo', '# solo', 's'), 'solo')
  const soloSha = await getHeadCommit(src)
  await git(src, ['checkout', '-b', 'b2'])
  await rm(join(src, 'solo.md'))
  await writeFile(join(src, 'one.md'), skillContent('one', '# one', 'a'), 'utf8')
  await writeFile(join(src, 'two.md'), skillContent('two', '# two', 'b'), 'utf8')
  await git(src, ['add', '-A'])
  await git(src, ['commit', '-m', 'two skills'])
  const twoSha = await getHeadCommit(src)

  const name = 'multi'
  const dest = await cloneEntry(name, src, 'main')
  await register(name, src, 'main', soloSha)
  await link.linkSkill(name, dest)
  assert.equal(await link.isLinked(name), true)

  const res = await core.switchVersion(name, 'b2', undefined, makeIO())
  assert.equal(res.kind, 'branch')
  assert.equal(res.before, soloSha)
  assert.equal(res.after, twoSha)
  assert.deepEqual([...res.links].sort(), ['one', 'two'])
  assert.equal(await link.isLinked(name), false, 'the old entry-named link is gone')
  assert.equal(await link.isLinked('one'), true)
  assert.equal(await link.isLinked('two'), true)
  assert.equal(await exists(join(dest, 'solo.md')), false)
  assert.equal(await exists(join(dest, 'one.md')), true)

  const entry = await entryOf(name)
  assert.equal(entry.ref, 'b2')
  assert.equal(entry.commit, twoSha)
})

test('a dirty clone is discarded after the core warns (install-time edits)', async () => {
  const src = join(home, 'src-dirty')
  await initRepo(src)
  // No frontmatter anywhere: the re-normalize steps stay inert, so the
  // post-switch file content is exactly what the upstream commit holds.
  await commitFile(src, 'SKILL.md', '# test skill\n', 'v1')
  const firstSha = await getHeadCommit(src)

  const name = 'dirty-skill'
  const dest = await cloneEntry(name, src, 'main')
  await register(name, src, 'main', firstSha)
  await link.linkSkill(name, dest)

  // Upstream moves; the clone carries a normalization-like local edit.
  await commitFile(src, 'SKILL.md', '# test skill v2\n', 'v2')
  const upstream = await getHeadCommit(src)
  await writeFile(join(dest, 'SKILL.md'), '# test skill\ndescription: normalized\n', 'utf8')

  const io = makeIO()
  const res = await core.switchVersion(name, 'main', undefined, io)
  assert.equal(res.wasDirty, true)
  assert.deepEqual(io.emitted, ['  ⚠ discarding local changes in nexus-managed clone\n'])
  assert.equal(res.before, firstSha)
  assert.equal(res.after, upstream)
  assert.equal(await getHeadCommit(dest), upstream)
  const content = (await readFile(join(dest, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n')
  assert.equal(content, '# test skill v2\n', 'the local edit was discarded, not merged')
  assert.deepEqual(res.links, [name])
})

test('offline fallback follows the --type hint when nothing can be fetched', async () => {
  const src = join(home, 'src-offline')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', skillContent('dual-skill', '# v1', 'd1'), 'v1')
  const tagSha = await getHeadCommit(src)
  await git(src, ['tag', 'dual'])
  await git(src, ['checkout', '-b', 'dual'])
  await commitFile(src, 'SKILL.md', skillContent('dual-skill', '# v2', 'd2'), 'v2')
  const branchSha = await getHeadCommit(src)
  await git(src, ['checkout', 'main'])

  const name = 'offline-skill'
  const dest = await cloneEntry(name, src, 'dual')
  await register(name, src, 'dual', branchSha)

  // Both namespaces become resolvable locally, then the remote disappears:
  // every fetch fails and only the local fallback ordering decides.
  await git(dest, ['fetch', '--depth', '1', 'origin', '+refs/tags/dual:refs/tags/dual'])
  await rm(src, { recursive: true, force: true })

  const io = makeIO()
  const pin = await core.switchVersion(name, 'dual', 'tag', io)
  assert.equal(pin.kind, 'pin', '--type tag resolves the local tag first')
  assert.equal(pin.after, tagSha)
  assert.equal(await getHeadCommit(dest), tagSha)

  const branch = await core.switchVersion(name, 'dual', 'branch', io)
  assert.equal(branch.kind, 'branch', '--type branch resolves origin/dual first')
  assert.equal(branch.before, tagSha)
  assert.equal(branch.after, branchSha)
  // This clone holds a branch *and* a tag named `dual`, so `symbolic-ref
  // --short` would render the ambiguous name as `heads/dual` (still a valid
  // checkout argument — probe-verified). The full ref is the reliable
  // invariant: HEAD is re-attached to the branch, not left detached.
  const { stdout: headRef } = await execFileAsync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: dest })
  assert.equal(headRef.trim(), 'refs/heads/dual')
  assert.equal(await getHeadCommit(dest), branchSha)
})

/* ------------------------------------------------------------------ */
/* CLI wrapper — argv parsing, exit codes, stream hygiene              */
/* ------------------------------------------------------------------ */

test('parseSwitchVersionArgs accepts both --type forms and rejects malformed input', () => {
  assert.deepEqual(cli.parseSwitchVersionArgs(['a', 'b']), { name: 'a', ref: 'b', refType: undefined })
  assert.deepEqual(cli.parseSwitchVersionArgs(['a', 'b', '--type', 'tag']), {
    name: 'a',
    ref: 'b',
    refType: 'tag',
  })
  assert.deepEqual(cli.parseSwitchVersionArgs(['--type=commit', 'a', 'b']), {
    name: 'a',
    ref: 'b',
    refType: 'commit',
  })
  assert.throws(() => cli.parseSwitchVersionArgs([]), /usage:/)
  assert.throws(() => cli.parseSwitchVersionArgs(['a']), /usage:/)
  assert.throws(() => cli.parseSwitchVersionArgs(['a', 'b', 'c']), /unexpected extra argument "c"/)
  assert.throws(() => cli.parseSwitchVersionArgs(['a', 'b', '--bogus']), /unknown argument "--bogus"/)
  assert.throws(
    () => cli.parseSwitchVersionArgs(['a', 'b', '--type', 'weird']),
    /unsupported --type "weird"/,
  )
  assert.throws(() => cli.parseSwitchVersionArgs(['a', 'b', '--type']), /--type requires a value/)
})

test('the CLI wrapper exits 1 for an unknown skill with clean stdout', async () => {
  const io = makeIO()
  const { code, err } = await captureErrors(io, () => cli.switchVersion(['ghost-xyz', 'main'], io))
  assert.equal(code, 1)
  assert.equal(err, 'No skill named "ghost-xyz".\n')
  assert.deepEqual(io.emitted, [], 'stdout stays clean — no "Switching…" banner')
})

test('the CLI wrapper exits 2 on usage errors', async () => {
  const io = makeIO()
  const { code, err } = await captureErrors(io, () => cli.switchVersion([], io))
  assert.equal(code, 2)
  assert.match(err, /^error: usage: dsh-skills-nexus switch-version/)
  assert.deepEqual(io.emitted, [])
})

test('the CLI wrapper maps a known skill + missing ref to the core error message', async () => {
  const src = join(home, 'src-cli-err')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', skillContent('cli-err', '# v1', 'd'), 'v1')
  const sha = await getHeadCommit(src)
  await cloneEntry('cli-err', src, 'main')
  await register('cli-err', src, 'main', sha)

  const io = makeIO()
  const { code, err } = await captureErrors(io, () => cli.switchVersion(['cli-err', 'nope'], io))
  assert.equal(code, 1)
  // The core's error classes carry complete messages — no `error:` prefix.
  assert.equal(err, 'Ref "nope" was not found — nothing was changed.\n')
  assert.deepEqual(io.emitted, ['Switching "cli-err" to nope…\n'])
})

test('the CLI wrapper prints the summary and exits 0 on a successful switch', async () => {
  const src = join(home, 'src-cli-ok')
  await initRepo(src)
  await commitFile(src, 'SKILL.md', skillContent('cli-ok', '# v1', 'one'), 'v1')
  const tagSha = await getHeadCommit(src)
  await git(src, ['tag', 'v1.0.0'])
  await commitFile(src, 'SKILL.md', skillContent('cli-ok', '# v2', 'two'), 'v2')
  const branchSha = await getHeadCommit(src)

  const dest = await cloneEntry('cli-ok', src, 'main')
  await register('cli-ok', src, 'main', branchSha)
  await link.linkSkill('cli-ok', dest)

  const io = makeIO()
  const { code, err } = await captureErrors(io, () =>
    cli.switchVersion(['cli-ok', 'v1.0.0', '--type', 'tag'], io),
  )
  assert.equal(code, 0)
  assert.equal(err, '')
  assert.deepEqual(io.emitted, [
    'Switching "cli-ok" to v1.0.0…\n',
    `  ✓ ${branchSha.slice(0, 7)} → ${tagSha.slice(0, 7)} (pinned)\n`,
    '  symlinks: 1 skill(s) rebuilt in ~/.dsh/skills/\n',
  ])
  assert.equal(await getHeadCommit(dest), tagSha)
})

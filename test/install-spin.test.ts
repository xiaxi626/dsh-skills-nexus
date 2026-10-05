import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OpsIO } from '../src/ops-io.js'

/**
 * The `io.spin` seam of the shared install core (`src/install.ts`).
 *
 * Before this seam existed the core imported the CLI's `withSpinner`
 * directly, which is why the module could not claim to be presentation-free
 * and why the panel could not run it without risking `\r`/ANSI in a polled job
 * record. These tests pin both halves of the replacement:
 *
 *   - the core calls `io.spin` with the CLI's own message and falls back to
 *     running the step inline when a front end has no indicator at all;
 *   - `cliIO.spin` *is* `withSpinner` (same function object), so the CLI keeps
 *     rendering exactly what it rendered before.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var is set in `before()`
 * before the first dynamic import (test/add.test.ts pattern).
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

let home: string
let spinMod: typeof import('../src/ops-io.js')
let installMod: typeof import('../src/install.js')
let gitMod: typeof import('../src/git.js')
let progressMod: typeof import('../src/cli/progress.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-spin-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  spinMod = await import('../src/ops-io.js')
  installMod = await import('../src/install.js')
  gitMod = await import('../src/git.js')
  progressMod = await import('../src/cli/progress.js')
  paths = await import('../src/paths.js')
  assert.ok(
    paths.REPOS_DIR.startsWith(home),
    `test isolation broken: paths bound to ${paths.REPOS_DIR}`,
  )
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A one-skill repo on `main`, plus the `file://` spec that points at it. */
async function makeSkillRepo(name: string): Promise<string> {
  const dir = join(home, name)
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Nexus Test'])
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} demo\n---\nbody\n`,
    'utf8',
  )
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'skill'])
  return 'file:///' + dir.replaceAll('\\', '/')
}

/** The install-phase parameters for `name`, with `io` as the only variable. */
function paramsFor(name: string, url: string, io: OpsIO): import('../src/install.js').GitInstallParams {
  return {
    spec: url,
    gitSpec: gitMod.parseGitSpec(url, 'main'),
    subdir: undefined,
    skillName: name,
    path: name,
    name: undefined,
    subdirLeaf: undefined,
    yes: true,
    io,
  }
}

/** An OpsIO that records every side effect instead of performing it. */
function recordingIO(
  spin?: <T>(message: string, fn: () => Promise<T>) => Promise<T>,
): { io: OpsIO; emitted: string[]; progress: Array<[string, string | undefined]> } {
  const emitted: string[] = []
  const progress: Array<[string, string | undefined]> = []
  const io: OpsIO = {
    interactive: false,
    confirm: async () => true, // never reached: the fixtures are plain skill repos
    progress: (stage: string, detail?: string) => {
      progress.push([stage, detail])
    },
    emit: (line: string) => {
      emitted.push(line)
    },
    error: () => {
      // the pre-clone preflight never fails in these fixtures; the install
      // core's own diagnostics are asserted through `emitted`
    },
  }
  if (spin !== undefined) io.spin = spin
  return { io, emitted, progress }
}

/* ------------------------------------------------------------------ */
/* The core calls the injected spin                                    */
/* ------------------------------------------------------------------ */

test('installFromGit wraps the clone in io.spin, once, with the CLI message', async () => {
  const url = await makeSkillRepo('src-spin')
  const seen: string[] = []
  const { io } = recordingIO(async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
    seen.push(message)
    return await fn()
  })

  const result = await installMod.installFromGit(paramsFor('src-spin', url, io))

  assert.equal(result.status, 'installed')
  // Exactly one spin, labelled the way the CLI's spinner has always been. The
  // wrapped fn must actually run — the clone either landed or it did not.
  assert.deepEqual(seen, ['cloning (main)'])
  assert.equal(result.clone.mode.length > 0, true)
  assert.equal((await stat(paths.repoDir('src-spin'))).isDirectory(), true)
  // The clone reports itself through io and registers the link, so the step
  // really ran inside the spinner rather than beside it.
  assert.equal(result.links.length, 1)
})

test('an injected spin that throws propagates and leaves no partial clone', async () => {
  const url = await makeSkillRepo('src-spin-throws')
  const { io } = recordingIO(() => Promise.reject(new Error('spin exploded')))

  await assert.rejects(
    installMod.installFromGit(paramsFor('src-spin-throws', url, io)),
    /spin exploded/,
  )
  // The clone-cleanup path is the same one a failing clone takes: the step
  // never ran, so nothing may be left under repos/.
  await assert.rejects(stat(paths.repoDir('src-spin-throws')), { code: 'ENOENT' })
})

/* ------------------------------------------------------------------ */
/* The seam is optional — a front end without an indicator still works */
/* ------------------------------------------------------------------ */

test('installFromGit runs inline when the front end has no spin at all', async () => {
  const url = await makeSkillRepo('src-nospin')
  // A bare OpsIO: no `spin` member exists, which is what the nine literal
  // stand-ins in src/ and test/ look like.
  const { io } = recordingIO()

  const result = await installMod.installFromGit(paramsFor('src-nospin', url, io))

  assert.equal(result.status, 'installed')
  assert.equal(result.entry?.name, 'src-nospin')
})

test('installFromGit also falls back when spin is explicitly undefined', async () => {
  const url = await makeSkillRepo('src-nospin-undef')
  const io = recordingIO().io
  io.spin = undefined // present-but-undefined, the `??` case

  const result = await installMod.installFromGit(paramsFor('src-nospin-undef', url, io))
  assert.equal(result.status, 'installed')
})

/* ------------------------------------------------------------------ */
/* cliIO.spin is the CLI's own spinner, unchanged                      */
/* ------------------------------------------------------------------ */

test('cliIO.spin is withSpinner itself, not a wrapper around it', () => {
  // Identity, not equivalence: a wrapper could silently drop the TTY gate, the
  // erase-line sequence or the timer's `unref`, and CLI output is byte-level
  // contract (`test/ops-io.test.ts`, `test/progress.test.ts`).
  assert.equal(spinMod.cliIO.spin, progressMod.withSpinner)
})

test('cliIO.spin stays silent on a non-TTY, exactly like withSpinner', async () => {
  const writes: string[] = []
  const origWrite = process.stderr.write
  process.stderr.write = ((chunk: string): boolean => {
    writes.push(String(chunk))
    return true
  }) as unknown as typeof process.stderr.write
  try {
    const value = await spinMod.cliIO.spin!('cloning (main)', async () => 42)
    assert.equal(value, 42)
  } finally {
    process.stderr.write = origWrite
  }
  // The test runner has no TTY, so the spinner's whole animation — including
  // the `\r`/`\x1b[2K` frames and the cursor hide/show pair — is a no-op.
  assert.deepEqual(writes, [])
})

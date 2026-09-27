import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Capability-probe and degradation branches of `cloneRepo`, driven through a
 * patched `child_process.execFile`.
 *
 * A real Git cannot be made to exhibit these states (its help output is
 * whatever it is, and it never fails to spawn), so the fallback paths — a Git
 * without `sparse-checkout`, a `set` without `--cone`, spawn failures,
 * unparseable probe output — are covered here against the real module code.
 * The happy paths run against real Git in `test/git.test.ts`.
 *
 * The patch must happen before `src/git.js` is first imported: the module
 * captures `promisify(execFile)` at load time, and `syncBuiltinESMExports`
 * makes the patched CJS object visible to that import. `node:test` runs each
 * file in its own process, so this cannot leak into the integration tests.
 */

const require = createRequire(import.meta.url)

interface Call {
  args: string[]
  cwd?: string
}

interface Reply {
  stdout?: string
  stderr?: string
  /** Non-zero numeric exit status — Git failing on its own. */
  exit?: number
  /** A non-numeric spawn failure, e.g. 'ENOENT'. */
  spawnError?: string
  /** Side effect to run before the result is delivered. */
  effect?: () => Promise<void>
}

type Handler = (args: string[], opts: { cwd?: string } | undefined) => Reply

const calls: Call[] = []
let handler: Handler = () => ({ stdout: '', stderr: '' })

function dispatch(
  args: string[],
  opts: { cwd?: string } | undefined,
  cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
): void {
  calls.push({ args, cwd: opts?.cwd })
  void (async () => {
    try {
      const reply = handler(args, opts)
      if (reply.effect) await reply.effect()
      if (reply.spawnError !== undefined) {
        cb(Object.assign(new Error(`spawn git ${reply.spawnError}`), { code: reply.spawnError }))
        return
      }
      const result = { stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
      if (reply.exit !== undefined && reply.exit !== 0) {
        const err = Object.assign(new Error(`git ${args.join(' ')} failed`), {
          code: reply.exit,
          ...result,
        })
        cb(err)
        return
      }
      cb(null, result)
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)))
    }
  })()
}

function execFileStub(_file: unknown, args: unknown, a?: unknown, b?: unknown): void {
  const opts = typeof a === 'object' && a !== null ? (a as { cwd?: string }) : undefined
  const cb = (typeof a === 'function' ? a : b) as (
    err: Error | null,
    result?: { stdout: string; stderr: string },
  ) => void
  dispatch(args as string[], opts, cb)
}

;(execFileStub as unknown as Record<symbol, unknown>)[promisify.custom] = (
  _file: unknown,
  args: unknown,
  opts?: unknown,
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    dispatch(args as string[], opts as { cwd?: string } | undefined, (err, result) =>
      err ? reject(err) : resolve(result!),
    )
  })

const childProcess = require('node:child_process') as typeof import('node:child_process')
childProcess.execFile = execFileStub as unknown as typeof childProcess.execFile
syncBuiltinESMExports()

let gitMod: typeof import('../src/git.js')

before(async () => {
  gitMod = await import('../src/git.js')
})

const tmpRoots: string[] = []
after(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true })
})

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-probe-'))
  tmpRoots.push(dir)
  return dir
}

/** Keep only the calls that match — strict routing fails on anything else. */
function route(table: Array<{ match: (args: string[]) => boolean; reply: Reply }>): Handler {
  return (args, opts) => {
    for (const entry of table) {
      if (entry.match(args)) return entry.reply
    }
    throw new Error(`unexpected git call: git ${args.join(' ')} (cwd: ${opts?.cwd ?? '<none>'})`)
  }
}

const USAGE_TOP =
  'usage: git sparse-checkout (init | list | set | add | reapply | disable | check-rules) [<options>]\n'
const USAGE_SET_CONE =
  'usage: git sparse-checkout set [--[no-]cone] [--[no-]sparse-index] [--skip-checks] [--stdin] [--] <dir>...\n'
const USAGE_SET_NO_CONE =
  'usage: git sparse-checkout (init | list | set | add | reapply | disable) [<options>]\n    --[no-]sparse-index  use a sparse index\n'

test('a Git without sparse-checkout degrades to a plain full clone', async () => {
  handler = route([
    {
      match: (a) => a[0] === 'sparse-checkout',
      reply: {
        stderr: "git: 'sparse-checkout' is not a git command. See 'git --help'.\n",
        exit: 1,
      },
    },
    { match: (a) => a[0] === 'clone', reply: { stdout: "Cloning into 'clone'...\n" } },
  ])
  calls.length = 0
  const dest = join(await tmpRoot(), 'clone')

  const res = await gitMod.cloneRepo(
    gitMod.parseGitSpec('file:///nonexistent/src#main'),
    dest,
    { subdir: 'skills/alpha' },
  )

  assert.equal(res.mode, 'full')
  assert.deepEqual(res.warnings, [gitMod.SPARSE_UNSUPPORTED_WARNING])
  const cloneCalls = calls.filter((c) => c.args[0] === 'clone')
  assert.equal(cloneCalls.length, 1)
  // The fallback is the original whole-repository clone — no partial flags.
  assert.ok(!cloneCalls[0]!.args.includes('--filter=blob:none'))
  assert.ok(cloneCalls[0]!.args.includes('--branch'))
  // The probe ran exactly once.
  assert.equal(calls.filter((c) => c.args[0] === 'sparse-checkout').length, 1)
})

test('a Git whose set lacks --cone completes the existing clone in place', async () => {
  handler = route([
    { match: (a) => a[0] === 'sparse-checkout' && a[1] === '-h', reply: { stderr: USAGE_TOP, exit: 129 } },
    {
      match: (a) => a[0] === 'clone',
      reply: {
        stdout: "Cloning into 'clone'...\n",
        stderr: 'warning: filtering not recognized by server, ignoring\n',
      },
    },
    { match: (a) => a[0] === 'sparse-checkout' && a[1] === 'set', reply: { stderr: USAGE_SET_NO_CONE, exit: 129 } },
    { match: (a) => a[0] === 'checkout', reply: { stdout: "Already on 'main'\n" } },
  ])
  calls.length = 0
  const dest = join(await tmpRoot(), 'clone')

  const res = await gitMod.cloneRepo(
    gitMod.parseGitSpec('file:///nonexistent/src#main'),
    dest,
    { subdir: 'skills/alpha' },
  )

  assert.equal(res.mode, 'full')
  assert.deepEqual(res.warnings, [gitMod.FILTER_IGNORED_WARNING, gitMod.SPARSE_UNSUPPORTED_WARNING])
  // The already-created no-checkout clone is reused — no second download.
  assert.equal(calls.filter((c) => c.args[0] === 'clone').length, 1)
  assert.ok(calls.some((c) => c.args[0] === 'checkout' && c.args[1] === 'main'))
  // `set` itself never ran; only its help was consulted.
  const setCalls = calls.filter((c) => c.args[0] === 'sparse-checkout' && c.args[1] === 'set')
  assert.equal(setCalls.length, 1)
  assert.ok(setCalls[0]!.args.includes('-h'))
})

test('unrecognized top-level probe output is a hard error, not a downgrade', async () => {
  handler = route([
    { match: (a) => a[0] === 'sparse-checkout', reply: { stderr: 'git: something unparseable\n', exit: 128 } },
  ])
  calls.length = 0
  const dest = join(await tmpRoot(), 'clone')

  await assert.rejects(
    gitMod.cloneRepo(gitMod.parseGitSpec('file:///nonexistent/src#main'), dest, { subdir: 'skills/alpha' }),
    /Unexpected "git sparse-checkout -h" output/,
  )
  assert.equal(calls.filter((c) => c.args[0] === 'clone').length, 0)
})

test('an unparseable "set -h" output aborts without checking out anything', async () => {
  handler = route([
    { match: (a) => a[0] === 'sparse-checkout' && a[1] === '-h', reply: { stderr: USAGE_TOP, exit: 129 } },
    { match: (a) => a[0] === 'clone', reply: { stdout: "Cloning into 'clone'...\n" } },
    { match: (a) => a[0] === 'sparse-checkout' && a[1] === 'set', reply: { stderr: 'mystery\n', exit: 128 } },
  ])
  calls.length = 0
  const dest = join(await tmpRoot(), 'clone')

  await assert.rejects(
    gitMod.cloneRepo(gitMod.parseGitSpec('file:///nonexistent/src#main'), dest, { subdir: 'skills/alpha' }),
    /Unexpected "git sparse-checkout set -h" output/,
  )
  assert.ok(!calls.some((c) => c.args[0] === 'checkout'))
})

test('a Git that cannot be spawned propagates instead of degrading', async () => {
  handler = () => ({ spawnError: 'ENOENT' })
  calls.length = 0
  const dest = join(await tmpRoot(), 'clone')

  await assert.rejects(
    gitMod.cloneRepo(gitMod.parseGitSpec('file:///nonexistent/src#main'), dest, { subdir: 'skills/alpha' }),
    (err: unknown) => (err as { code?: string }).code === 'ENOENT',
  )
  assert.equal(calls.filter((c) => c.args[0] === 'clone').length, 0)
})

test('a raw commit SHA uses the filtered no-checkout fallback chain', async () => {
  const sha = 'a'.repeat(40)
  handler = route([
    { match: (a) => a[0] === 'sparse-checkout' && a[1] === '-h', reply: { stderr: USAGE_TOP, exit: 129 } },
    {
      match: (a) => a[0] === 'clone' && a.includes('--branch'),
      reply: { stderr: `fatal: Remote branch ${sha} not found in upstream origin\n`, exit: 128 },
    },
    { match: (a) => a[0] === 'clone', reply: { stdout: "Cloning into 'clone'...\n" } },
    { match: (a) => a[0] === 'fetch', reply: { stdout: '' } },
    {
      match: (a) => a[0] === 'sparse-checkout' && a[1] === 'set' && a.includes('-h'),
      reply: { stderr: USAGE_SET_CONE, exit: 129 },
    },
    { match: (a) => a[0] === 'sparse-checkout' && a[1] === 'set', reply: { stdout: '' } },
    { match: (a) => a[0] === 'checkout', reply: { stdout: 'HEAD is now at aaaaaaa\n' } },
  ])
  calls.length = 0
  const dest = join(await tmpRoot(), 'clone')

  const res = await gitMod.cloneRepo(
    gitMod.parseGitSpec(`file:///nonexistent/src#${sha}`),
    dest,
    { subdir: 'skills/alpha' },
  )

  assert.equal(res.mode, 'sparse')
  assert.deepEqual(res.warnings, [])
  const cloneCalls = calls.filter((c) => c.args[0] === 'clone')
  assert.equal(cloneCalls.length, 2)
  assert.ok(cloneCalls[0]!.args.includes('--branch'))
  assert.ok(!cloneCalls[1]!.args.includes('--branch'))
  // Both clone attempts (and the fetch) stay filtered and worktree-less.
  assert.ok(cloneCalls.every((c) => c.args.includes('--filter=blob:none')))
  assert.ok(cloneCalls.every((c) => c.args.includes('--no-checkout')))
  const fetch = calls.find((c) => c.args[0] === 'fetch')
  assert.ok(fetch)
  assert.ok(fetch.args.includes('--filter=blob:none'))
  assert.ok(fetch.args.includes(sha))
  // The rules are installed before the first checkout, with the probed flags.
  const set = calls.find((c) => c.args[0] === 'sparse-checkout' && c.args[1] === 'set' && !c.args.includes('-h'))
  assert.ok(set)
  assert.ok(set.args.includes('--cone'))
  assert.ok(set.args.includes('--skip-checks'))
  assert.ok(set.args.includes('--'))
  assert.ok(set.args.includes('skills/alpha'))
  const checkout = calls.find((c) => c.args[0] === 'checkout')
  assert.equal(checkout!.args[1], sha)
})

test('a failed branch clone is retried once and the partial directory is discarded', async () => {
  const root = await tmpRoot()
  const dest = join(root, 'clone')
  handler = route([
    { match: (a) => a[0] === 'sparse-checkout', reply: { stderr: USAGE_TOP, exit: 129 } },
    {
      match: (a) => a[0] === 'clone',
      reply: {
        stderr: 'fatal: unable to access remote\n',
        exit: 128,
        // Simulate Git creating the target directory before failing.
        effect: async () => {
          await mkdir(dest, { recursive: true })
        },
      },
    },
  ])
  calls.length = 0

  await assert.rejects(
    gitMod.cloneRepo(gitMod.parseGitSpec('file:///nonexistent/src#main'), dest, { subdir: 'skills/alpha' }),
    /fatal: unable to access remote/,
  )
  // One initial attempt + one retry…
  assert.equal(calls.filter((c) => c.args[0] === 'clone').length, 2)
  // …and the partial directory is gone afterwards.
  await assert.rejects(stat(dest), { code: 'ENOENT' })
})

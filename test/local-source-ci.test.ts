import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = process.cwd()
const cliPath = join(projectRoot, 'lib', 'cli', 'index.js')

let scratch: string
let home: string
let remote: string

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'nexus-local-source-ci-'))
  home = join(scratch, 'home')
  remote = join(scratch, 'remote')
  await mkdir(home, { recursive: true })
  await mkdir(remote, { recursive: true })
})

after(async () => {
  await rm(scratch, { recursive: true, force: true })
})

async function run(
  file: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args, {
    ...options,
    encoding: 'utf8',
  })
  return { stdout, stderr }
}

function git(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run('git', args, {
    cwd: remote,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Nexus CI',
      GIT_AUTHOR_EMAIL: 'nexus-ci@example.com',
      GIT_COMMITTER_NAME: 'Nexus CI',
      GIT_COMMITTER_EMAIL: 'nexus-ci@example.com',
    },
  })
}

function nexus(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    GIT_TERMINAL_PROMPT: '0',
  }
  delete env.DSH_SKILLS_NEXUS_HOME
  return run(process.execPath, [cliPath, ...args], { cwd: scratch, env })
}

async function commitSkill(body: string, message: string): Promise<string> {
  await writeFile(
    join(remote, 'SKILL.md'),
    `---\nname: local-source\ndescription: local source fixture\n---\n\n${body}\n`,
    'utf8',
  )
  await git(['add', 'SKILL.md'])
  await git(['commit', '-m', message])
  return (await git(['rev-parse', 'HEAD'])).stdout.trim()
}

interface ListReport {
  version: number
  entries: Array<{ name: string; commit?: string; locked?: boolean }>
}

interface Manifest {
  skills: Array<{ name: string; path: string }>
}

interface DoctorReport {
  version: number
  checks: Array<{
    issues: Array<{ code: string; name?: string; detail?: string; locked?: boolean }>
  }>
}

test('compiled CLI previews and restores a local file source on every CI platform', async () => {
  await git(['init', '-b', 'main'])
  const recorded = await commitSkill('version one', 'version one')
  const source = pathToFileURL(remote).href
  const archive = join(scratch, 'local-source.zip')

  await nexus(['add', source, '--name', 'local-source', '--yes'])
  const manifestPath = join(home, 'skills-nexus', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
  const installed = manifest.skills.find((entry) => entry.name === 'local-source')
  assert.ok(installed !== undefined)
  const clone = join(home, 'skills-nexus', 'repos', installed.path)
  assert.equal((await run('git', ['rev-parse', 'HEAD'], { cwd: clone })).stdout.trim(), recorded)

  const unchanged = await nexus(['diff', 'local-source'])
  assert.equal(unchanged.stdout, '', 'no diff is still a successful, empty preview')

  await nexus(['export', 'local-source', '--out', archive])
  const advanced = await commitSkill('version two', 'version two')
  assert.notEqual(advanced, recorded)

  const preview = await nexus(['diff', 'local-source'])
  assert.match(preview.stdout, /diff --git a\/SKILL\.md b\/SKILL\.md/)
  assert.match(preview.stdout, /-version one/)
  assert.match(preview.stdout, /\+version two/)
  assert.equal(
    (await run('git', ['rev-parse', 'HEAD'], { cwd: clone })).stdout.trim(),
    recorded,
    'preview does not move the installed checkout',
  )

  await nexus(['remove', 'local-source', '--yes'])
  await nexus(['import', archive, '--locked'])

  const list = JSON.parse((await nexus(['list', '--json'])).stdout) as ListReport
  assert.equal(list.version, 1)
  assert.deepEqual(list.entries.map(({ name, commit, locked }) => ({ name, commit, locked })), [
    { name: 'local-source', commit: recorded, locked: true },
  ])

  assert.equal((await run('git', ['rev-parse', 'HEAD'], { cwd: clone })).stdout.trim(), recorded)
  assert.equal(
    (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: clone })).stdout.trim(),
    'HEAD',
  )
  assert.match(await readFile(join(clone, 'SKILL.md'), 'utf8'), /version one/)

  const doctor = JSON.parse(
    (await nexus(['doctor', '--updates', '--json'])).stdout,
  ) as DoctorReport
  const lock = doctor.checks.flatMap((check) => check.issues).find((issue) => issue.name === 'local-source')
  assert.equal(lock?.code, 'locked')
  assert.equal(lock?.locked, true)
  assert.match(lock?.detail ?? '', /exact package commit/)
})

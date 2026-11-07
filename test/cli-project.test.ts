import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DANGLING_LINKS_OBSERVABLE, removeTree } from './fs-helpers.js'

/**
 * End-to-end tests for the project scope through the real CLI.
 *
 * Each case spawns `node --import tsx src/cli/index.ts …` with a temporary
 * `DSH_HOME` and a temporary project, because the behaviour that matters is
 * process-level: the exit code, the JSON document on stdout, the diagnostics on
 * stderr, and what the filesystem looks like afterwards. A link's target is a
 * user directory, so every assertion double-checks that removal never touched
 * it and that no manifest entry appeared.
 */

const execFileAsync = promisify(execFile)
const CLI = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url))
/**
 * The tsx loader as an absolute URL: the child runs with `cwd` set to the
 * project (so `--project` must detect the root from cwd), and a bare `tsx`
 * specifier would resolve against that unrelated directory instead.
 */
const TSX = import.meta.resolve('tsx')

let base: string
let home: string

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'nexus-cli-project-'))
  home = join(base, 'home')
})

after(async () => {
  await removeTree(base)
})

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home }
  delete env.DSH_SKILLS_NEXUS_HOME
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [`--import=${TSX}`, CLI, ...args], {
      cwd,
      env,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const failure = err as { code?: number; stdout?: string; stderr?: string }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

/** A project directory carrying the `.git` marker the root detector walks to. */
async function makeProject(name: string): Promise<string> {
  const dir = join(base, 'projects', name)
  await mkdir(join(dir, '.git'), { recursive: true })
  return dir
}

/** A source directory with a SKILL.md; returns its absolute path. */
async function makeSkill(rel: string, name: string): Promise<string> {
  const dir = join(base, 'sources', rel)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: demo\n---\n\n# ${name}\n`, 'utf8')
  return dir
}

test('list --project detects the project root from cwd', async () => {
  const project = await makeProject('detect')
  const result = await runCli(['list', '--project'], project)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /No project skills in .*\.dsh[\\/]skills/)
})

test('link -> list -> remove keeps no manifest state and never touches the target', async () => {
  const project = await makeProject('chain')
  const source = await makeSkill('chain/my-skill', 'my-skill')

  const linked = await runCli(['link', '--project', source, '--json'], project)
  assert.equal(linked.code, 0, linked.stderr)
  const linkReport = JSON.parse(linked.stdout) as {
    projectRoot: string
    source: string
    results: Array<{ name: string; status: string }>
    summary: Record<string, number>
  }
  assert.equal(resolve(linkReport.projectRoot), resolve(project))
  assert.equal(resolve(linkReport.source), resolve(source))
  assert.deepEqual(linkReport.results, [{ name: 'my-skill', target: resolve(source), status: 'link' }])
  assert.equal(linkReport.summary.linked, 1)

  const listed = await runCli(['list', '--project', '--json'], project)
  assert.equal(listed.code, 0, listed.stderr)
  const listReport = JSON.parse(listed.stdout) as {
    projectRoot: string
    entries: Array<{ name: string; kind: string; target: string; dangling: boolean }>
  }
  assert.equal(listReport.entries.length, 1)
  assert.equal(listReport.entries[0]!.name, 'my-skill')
  assert.equal(listReport.entries[0]!.kind, 'link')
  assert.equal(listReport.entries[0]!.dangling, false)

  // The whole point of project scope: no manifest entry was written.
  await assert.rejects(stat(join(home, 'skills-nexus', 'manifest.json')))

  const removed = await runCli(['remove', '--project', 'my-skill', '--json'], project)
  assert.equal(removed.code, 0, removed.stderr)
  const removal = JSON.parse(removed.stdout) as { results: unknown[]; summary: Record<string, number> }
  assert.deepEqual(removal.results, [{ name: 'my-skill', status: 'removed' }])
  assert.equal(removal.summary.removed, 1)

  // The target directory is untouched and the project entry is gone.
  assert.equal((await stat(join(source, 'SKILL.md'))).isFile(), true)
  const after = await runCli(['list', '--project', '--json'], project)
  assert.deepEqual((JSON.parse(after.stdout) as { entries: unknown[] }).entries, [])
})

test('list --project names a folder SKILL.md by its frontmatter name', async () => {
  const project = await makeProject('folder-name')
  await writeFile(
    join(project, 'SKILL.md'),
    '---\nname: folder-skill\ndescription: the folder itself\n---\n',
    'utf8',
  )

  const result = await runCli(['list', '--project', '--json'], project)
  assert.equal(result.code, 0, result.stderr)
  const report = JSON.parse(result.stdout) as {
    folderSkills: Array<{ name: string; description: string; linked: boolean }>
    entries: unknown[]
  }
  assert.equal(report.folderSkills.length, 1)
  assert.equal(report.folderSkills[0]!.name, 'folder-skill')
  assert.equal(report.folderSkills[0]!.description, 'the folder itself')
  assert.equal(report.folderSkills[0]!.linked, false)
  assert.deepEqual(report.entries, [])
})

test('remove --project refuses user files and exits 1', async () => {
  const project = await makeProject('refuse')
  const vendored = join(project, '.dsh', 'skills', 'vendored')
  await mkdir(vendored, { recursive: true })
  await writeFile(join(vendored, 'SKILL.md'), '---\nname: vendored\n---\n', 'utf8')

  const result = await runCli(['remove', '--project', 'vendored'], project)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /refusing to remove user files/)
  assert.equal((await stat(join(vendored, 'SKILL.md'))).isFile(), true)
})

test('doctor --project reports a dangling link as a warning', async (t) => {
  if (!DANGLING_LINKS_OBSERVABLE) {
    t.skip('this platform cannot stage a link whose target does not exist')
    return
  }
  const project = await makeProject('doctor')
  const skills = join(project, '.dsh', 'skills')
  await mkdir(skills, { recursive: true })
  await symlink(join(base, 'missing', 'gone'), join(skills, 'gone'), 'junction')

  const result = await runCli(['doctor', '--project', '--json'], project)
  assert.equal(result.code, 0, result.stderr)
  const report = JSON.parse(result.stdout) as {
    checks: Array<{ id: string; status: string; issues: Array<{ name: string }> }>
    summary: { errors: number; warnings: number }
  }
  assert.equal(report.checks.length, 1, 'global checks do not run in project mode')
  assert.equal(report.checks[0]!.id, 'project-links')
  assert.equal(report.checks[0]!.status, 'warn')
  assert.equal(report.checks[0]!.issues[0]!.name, 'gone')
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.warnings, 1)

  // A dangling link is still removable — that is how it gets cleaned up.
  const removed = await runCli(['remove', '--project', 'gone', '--json'], project)
  assert.equal(removed.code, 0, removed.stderr)
})

test('list --all joins project and global scopes from the project cwd', async () => {
  const project = await makeProject('all')
  const source = await makeSkill('all/shared-name', 'shared-name')
  const linked = await runCli(['link', '--project', source, '--json'], project)
  assert.equal(linked.code, 0, linked.stderr)

  const result = await runCli(['list', '--all'], project)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /project\s+shared-name/)
  assert.match(result.stdout, /project root:/)
  assert.doesNotMatch(result.stdout, /\{/, '--all is a human table, never JSON')
})

test('an explicit --project-root must name an existing directory', async () => {
  const project = await makeProject('bad-root')
  const missing = join(base, 'does-not-exist')
  const result = await runCli(['list', '--project', '--project-root', missing], project)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /does not exist or is not a directory/)
})

test('a UNC source is refused with a clear message on Windows', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('UNC targets are a Windows concern')
    return
  }
  const project = await makeProject('unc')
  const result = await runCli(
    ['link', '--project', '\\\\server\\share\\skill', '--project-root', project],
    project,
  )
  assert.equal(result.code, 1)
  assert.match(result.stderr, /UNC path/)
})

test('link --project rejects the source-registry flags', async () => {
  const project = await makeProject('reject-flags')
  const source = await makeSkill('reject-flags/my-skill', 'my-skill')
  const result = await runCli(['link', '--project', source, '--force'], project)
  assert.equal(result.code, 2)
  assert.match(result.stderr, /do not apply/)
})

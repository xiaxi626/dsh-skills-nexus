import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { detectProjectRoot } from '../src/project-root.js'
import { DANGLING_LINKS_OBSERVABLE, removeTree } from './fs-helpers.js'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Core tests for the project scope (`src/project.ts`).
 *
 * These run against a real filesystem rather than mocks because the contract
 * *is* the filesystem: a link is what `realpath` resolves, a project skill is
 * what one `readdir` of `<project>/.dsh/skills` returns, and "never delete user
 * files" is asserted by checking the bytes are still there afterwards.
 *
 * `paths.ts` reads DSH_HOME at import time and the project core takes its
 * per-skill locks under that home, so the env var is set before the dynamic
 * import (the `test/link.test.ts` pattern).
 */

/**
 * Every fixture lives under a per-run `mkdtemp` base. Nothing here reads a
 * developer's own project or the repository's `.dsh/skills`; the examples are
 * synthetic directories with synthetic SKILL.md content.
 */
let base: string
let project: typeof import('../src/project.js')
let link: typeof import('../src/link.js')
let paths: typeof import('../src/paths.js')

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'nexus-project-'))
  process.env.DSH_HOME = join(base, 'home')
  delete process.env.DSH_SKILLS_NEXUS_HOME
  project = await import('../src/project.js')
  link = await import('../src/link.js')
  paths = await import('../src/paths.js')
})

after(async () => {
  await removeTree(base)
  delete process.env.DSH_HOME
})

const silentIO: OpsIO = {
  interactive: false,
  confirm: async () => false,
  progress: () => {},
  emit: () => {},
  error: () => {},
}

/** A project directory carrying the `.git` marker detectProjectRoot looks for. */
async function makeProject(name: string): Promise<string> {
  const dir = join(base, 'projects', name)
  await mkdir(join(dir, '.git'), { recursive: true })
  return dir
}

/** A directory with a SKILL.md; returns its absolute path. */
async function makeSkillDir(rel: string, frontmatter: string): Promise<string> {
  const dir = join(base, 'sources', rel)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# skill\n`, 'utf8')
  return dir
}

const DEFAULT_FM = 'name: demo\ndescription: demo skill'

/* ------------------------------------------------------------------ */
/* detectProjectRoot                                                   */
/* ------------------------------------------------------------------ */

test('detectProjectRoot walks up to the nearest .git ancestor', async () => {
  const root = join(base, 'detect', 'repo')
  await mkdir(join(root, '.git'), { recursive: true })
  const nested = join(root, 'src', 'deep')
  await mkdir(nested, { recursive: true })
  assert.equal(detectProjectRoot(nested), resolve(root))
})

test('detectProjectRoot accepts a .git file (linked worktree)', async () => {
  const root = join(base, 'detect', 'worktree')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, '.git'), 'gitdir: /elsewhere\n', 'utf8')
  assert.equal(detectProjectRoot(root), resolve(root))
})

test('detectProjectRoot falls back to the starting directory', async () => {
  const plain = join(base, 'detect', 'plain')
  await mkdir(plain, { recursive: true })
  assert.equal(detectProjectRoot(plain), resolve(plain))
})

/* ------------------------------------------------------------------ */
/* listProjectSkills                                                   */
/* ------------------------------------------------------------------ */

test('listProjectSkills returns [] when the project has no skills root', async () => {
  const root = await makeProject('empty')
  assert.deepEqual(await project.listProjectSkills(root), [])
})

test('listProjectSkills classifies a link and resolves its target', async () => {
  const root = await makeProject('list-link')
  const target = await makeSkillDir('list-link/skill-a', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'skill-a'), target)

  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.name, 'skill-a')
  assert.equal(entries[0]!.kind, 'link')
  assert.equal(entries[0]!.dangling, false)
  assert.equal(await realpath(entries[0]!.target!), await realpath(target))
})

test('listProjectSkills marks a real directory as user files', async () => {
  const root = await makeProject('list-files')
  const vendored = join(paths.projectSkillsDir(root), 'vendored')
  await mkdir(vendored, { recursive: true })
  await writeFile(join(vendored, 'SKILL.md'), '---\nname: vendored\n---\n', 'utf8')

  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'files')
  assert.equal(entries[0]!.target, null)
  assert.equal(entries[0]!.dangling, false)
})

test('listProjectSkills reports a dangling link with its recovered target', async (t) => {
  if (!DANGLING_LINKS_OBSERVABLE) {
    t.skip('this platform cannot stage a link whose target does not exist')
    return
  }
  const root = await makeProject('list-dangling')
  const missing = join(base, 'sources', 'list-dangling', 'gone')
  await mkdir(paths.projectSkillsDir(root), { recursive: true })
  // 'junction' is ignored on POSIX and is what lets a Windows run stage a
  // link to a target that does not exist yet (a plain directory symlink needs
  // a privilege junction creation does not).
  await symlink(missing, project.projectSkillPath(root, 'gone-skill'), 'junction')

  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'link')
  assert.equal(entries[0]!.dangling, true)
  assert.equal(entries[0]!.target, resolve(missing))
})

/* ------------------------------------------------------------------ */
/* planProjectLink — name derivation                                   */
/* ------------------------------------------------------------------ */

test('a root-layout skill is named after its directory, not its frontmatter', async () => {
  const root = await makeProject('plan-root')
  const source = await makeSkillDir('plan-root/solo-dir', 'name: frontmatter-name\ndescription: demo')
  const plan = await project.planProjectLink(root, source)
  assert.equal(plan.results.length, 1)
  assert.equal(plan.results[0]!.name, 'solo-dir')
  assert.equal(plan.results[0]!.status, 'link')
  assert.equal(plan.results[0]!.target, resolve(source))
})

test('a subdirectory collection names each skill after its subdirectory', async () => {
  const root = await makeProject('plan-subdirs')
  const collection = join(base, 'sources', 'plan-subdirs', 'collection')
  await makeSkillDir('plan-subdirs/collection/alpha', 'name: ignored-alpha\ndescription: a')
  await makeSkillDir('plan-subdirs/collection/beta', 'name: beta\ndescription: b')
  const plan = await project.planProjectLink(root, collection)
  assert.deepEqual(
    plan.results.map((r) => [r.name, r.status]).sort(),
    [['alpha', 'link'], ['beta', 'link']],
  )
})

test('a flat markdown skill is named after the file stem', async () => {
  const root = await makeProject('plan-flat')
  const source = join(base, 'sources', 'plan-flat', 'flat')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'notes.md'), '---\nname: doc-name\ndescription: flat\n---\n', 'utf8')
  const plan = await project.planProjectLink(root, source)
  assert.deepEqual(plan.results.map((r) => [r.name, r.status]), [['notes', 'link']])
})

test('a non-ASCII directory falls back to a valid frontmatter name', async () => {
  const root = await makeProject('plan-fallback')
  const collection = join(base, 'sources', 'plan-fallback', 'collection')
  await makeSkillDir('plan-fallback/collection/中文技能', 'name: zh-skill\ndescription: zh')
  const plan = await project.planProjectLink(root, collection)
  assert.deepEqual(plan.results.map((r) => [r.name, r.status]), [['zh-skill', 'link']])
})

test('a non-ASCII directory without a usable frontmatter name is invalid', async () => {
  const root = await makeProject('plan-invalid')
  const collection = join(base, 'sources', 'plan-invalid', 'collection')
  await makeSkillDir('plan-invalid/collection/中文技能', 'description: no name here')
  const plan = await project.planProjectLink(root, collection)
  assert.equal(plan.results.length, 1)
  assert.equal(plan.results[0]!.status, 'invalid')
  assert.match(plan.results[0]!.error!, /cannot derive a DSH skill name/)
})

/* ------------------------------------------------------------------ */
/* planProjectLink — conflicts                                          */
/* ------------------------------------------------------------------ */

test('a link that already points at the source is unchanged', async () => {
  const root = await makeProject('plan-unchanged')
  const source = await makeSkillDir('plan-unchanged/skill-a', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'skill-a'), source)

  const plan = await project.planProjectLink(root, source)
  assert.equal(plan.results[0]!.status, 'unchanged')
})

test('a link pointing elsewhere is replaced, never deleted as user content', async () => {
  const root = await makeProject('plan-replace')
  const first = await makeSkillDir('plan-replace/first/skill-b', DEFAULT_FM)
  const second = await makeSkillDir('plan-replace/second/skill-b', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'skill-b'), first)

  const plan = await project.planProjectLink(root, second)
  assert.equal(plan.results[0]!.status, 'replace')
})

test('a real directory at the name is a collision and keeps its content', async () => {
  const root = await makeProject('plan-collision')
  const source = await makeSkillDir('plan-collision/skill-c', DEFAULT_FM)
  const occupied = project.projectSkillPath(root, 'skill-c')
  await mkdir(occupied, { recursive: true })
  await writeFile(join(occupied, 'keep.txt'), 'user content', 'utf8')

  const plan = await project.planProjectLink(root, source)
  assert.equal(plan.results[0]!.status, 'collision')
  assert.match(plan.results[0]!.error!, /refusing to replace user content/)

  await project.applyProjectLink(plan, silentIO)
  assert.equal(await readFile(join(occupied, 'keep.txt'), 'utf8'), 'user content')
  assert.equal((await stat(occupied)).isDirectory(), true)
  assert.equal(await link.isLinkAt(occupied), false)
})

test('a UNC source is refused on Windows with a clear error', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('UNC targets are a Windows concern')
    return
  }
  const root = await makeProject('unc')
  const plan = await project.planProjectLink(root, '\\\\server\\share\\skill')
  assert.equal(plan.results.length, 1)
  assert.equal(plan.results[0]!.status, 'invalid')
  assert.match(plan.results[0]!.error!, /UNC path/)
})

test('listProjectSkills parses a flat SKILL.md file instead of showing only its filename', async () => {
  const root = await makeProject('list-flat-name')
  const skills = paths.projectSkillsDir(root)
  await mkdir(skills, { recursive: true })
  await writeFile(join(skills, 'SKILL.md'), '---\nname: flat-example-skill\ndescription: migrate themes\n---\n', 'utf8')

  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.name, 'SKILL.md')
  assert.equal(entries[0]!.kind, 'files')
  assert.equal(entries[0]!.skill?.name, 'flat-example-skill')
  assert.equal(entries[0]!.skill?.description, 'migrate themes')
  assert.equal(entries[0]!.skill?.valid, true)
})

test('a real project skill directory exposes its parsed metadata', async () => {
  const root = await makeProject('list-real-skill')
  const dir = project.projectSkillPath(root, 'vendored-skill')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: vendored-skill\ndescription: vendored by hand\n---\n', 'utf8')

  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'files')
  assert.equal(entries[0]!.skill?.name, 'vendored-skill')
  assert.equal(entries[0]!.skill?.description, 'vendored by hand')
})

test('scanProjectFolder reads the folder itself and tracks its link state', async () => {
  const root = await makeProject('folder-scan')
  await writeFile(join(root, 'SKILL.md'), '---\nname: folder-skill\ndescription: folder skill\n---\n', 'utf8')

  const before = await project.projectReport(root)
  assert.equal(before.folderSkills.length, 1)
  assert.equal(before.folderSkills[0]!.name, 'folder-skill')
  assert.equal(before.folderSkills[0]!.description, 'folder skill')
  assert.equal(before.folderSkills[0]!.linked, false)
  assert.equal(before.folderSkills[0]!.linkName, null)

  await link.linkAt(project.projectSkillPath(root, 'folder-skill'), root)
  const after = await project.projectReport(root)
  assert.equal(after.folderSkills[0]!.linked, true)
  assert.equal(after.folderSkills[0]!.linkName, 'folder-skill')
  assert.equal(after.entries[0]!.skill?.name, 'folder-skill')
})

test('setProjectLinkEnabled moves a link out of the scanned root and back', async () => {
  const root = await makeProject('toggle-link')
  const target = await makeSkillDir('toggle-link/skill-a', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'skill-a'), target)

  assert.equal(await project.setProjectLinkEnabled(root, 'skill-a', false), 'disabled')
  assert.equal(await link.isLinkAt(project.projectSkillPath(root, 'skill-a')), false)
  const disabledPath = join(paths.projectDisabledSkillsDir(root), 'skill-a')
  assert.equal(await link.isLinkAt(disabledPath), true)

  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.name, 'skill-a')
  assert.equal(entries[0]!.enabled, false)

  assert.equal(await project.setProjectLinkEnabled(root, 'skill-a', true), 'enabled')
  assert.equal(await link.isLinkAt(project.projectSkillPath(root, 'skill-a')), true)
  assert.equal(await project.setProjectLinkEnabled(root, 'skill-a', true), 'already-enabled')
})

test('projectReport marks a disabled link when the folder itself is the skill source', async () => {
  // makeProject places this under the per-run mkdtemp base, not a user folder.
  const root = await makeProject('toggle-folder')
  await writeFile(join(root, 'SKILL.md'), `---\n${DEFAULT_FM}\n---\n`, 'utf8')
  await link.linkAt(project.projectSkillPath(root, 'toggle-folder'), root)
  assert.equal(await project.setProjectLinkEnabled(root, 'toggle-folder', false), 'disabled')

  const report = await project.projectReport(root)
  assert.equal(report.folderSkills.length, 1)
  assert.equal(report.folderSkills[0]!.disabled, true)
  assert.equal(report.folderSkills[0]!.linked, false)
})

test('removeProjectLink also removes a disabled link', async () => {
  const root = await makeProject('toggle-remove')
  const target = await makeSkillDir('toggle-remove/skill-b', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'skill-b'), target)
  assert.equal(await project.setProjectLinkEnabled(root, 'skill-b', false), 'disabled')

  assert.equal(await project.removeProjectLink(root, 'skill-b'), 'removed')
  assert.equal(await link.isLinkAt(join(paths.projectDisabledSkillsDir(root), 'skill-b')), false)
  assert.equal(await link.isLinkAt(project.projectSkillPath(root, 'skill-b')), false)
})

test('setProjectLinkEnabled refuses a real directory at the link name', async () => {
  const root = await makeProject('toggle-refuse')
  const dir = project.projectSkillPath(root, 'vendored')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: vendored\n---\n', 'utf8')

  assert.equal(await project.setProjectLinkEnabled(root, 'vendored', false), 'not-a-link')
  assert.equal((await stat(join(dir, 'SKILL.md'))).isFile(), true)
})

test('two skills deriving one name collide instead of overwriting each other', async () => {
  const root = await makeProject('plan-duplicate')
  const source = join(base, 'sources', 'plan-duplicate', 'dup')
  await makeSkillDir('plan-duplicate/dup/dup', DEFAULT_FM)
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'dup.md'), '---\nname: duplicate\ndescription: flat dup\n---\n', 'utf8')

  const plan = await project.planProjectLink(root, source)
  const sameName = plan.results.filter((r) => r.name === 'dup')
  assert.equal(sameName.length, 2)
  assert.equal(sameName[0]!.status, 'link')
  assert.equal(sameName[1]!.status, 'collision')
})

/* ------------------------------------------------------------------ */
/* applyProjectLink                                                    */
/* ------------------------------------------------------------------ */

test('applyProjectLink creates the link and a second plan is unchanged', async () => {
  const root = await makeProject('apply')
  const source = await makeSkillDir('apply/apply-skill', DEFAULT_FM)

  const plan = await project.planProjectLink(root, source)
  assert.equal(plan.results[0]!.status, 'link')
  assert.deepEqual(project.summarizeProjectLink(plan), {
    linked: 1, replaced: 0, unchanged: 0, failed: 0,
  })

  await project.applyProjectLink(plan, silentIO)
  const entries = await project.listProjectSkills(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'link')
  assert.equal(entries[0]!.dangling, false)

  const again = await project.planProjectLink(root, source)
  assert.equal(again.results[0]!.status, 'unchanged')
  assert.deepEqual(project.summarizeProjectLink(again), {
    linked: 0, replaced: 0, unchanged: 1, failed: 0,
  })
})

test('applyProjectLink repoints a replace result at the new directory', async () => {
  const root = await makeProject('apply-replace')
  const first = await makeSkillDir('apply-replace/first/swap-skill', DEFAULT_FM)
  const second = await makeSkillDir('apply-replace/second/swap-skill', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'swap-skill'), first)

  const plan = await project.planProjectLink(root, second)
  assert.equal(plan.results[0]!.status, 'replace')
  await project.applyProjectLink(plan, silentIO)

  const entries = await project.listProjectSkills(root)
  assert.equal(await realpath(entries[0]!.target!), await realpath(second))
})

/* ------------------------------------------------------------------ */
/* removeProjectLink                                                   */
/* ------------------------------------------------------------------ */

test('removeProjectLink removes a link and leaves its target intact', async () => {
  const root = await makeProject('remove-link')
  const target = await makeSkillDir('remove-link/removable', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'removable'), target)

  assert.equal(await project.removeProjectLink(root, 'removable'), 'removed')
  assert.equal(await link.isLinkAt(project.projectSkillPath(root, 'removable')), false)
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8').then((s) => s.length > 0), true)
})

test('removeProjectLink reports not-found for an absent name', async () => {
  const root = await makeProject('remove-missing')
  assert.equal(await project.removeProjectLink(root, 'nope'), 'not-found')
})

test('removeProjectLink refuses a real directory and removes nothing', async () => {
  const root = await makeProject('remove-files')
  const dir = project.projectSkillPath(root, 'vendored')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: vendored\n---\n', 'utf8')

  assert.equal(await project.removeProjectLink(root, 'vendored'), 'not-a-link')
  assert.equal(await readFile(join(dir, 'SKILL.md'), 'utf8'), '---\nname: vendored\n---\n')
})

test('removeProjectLink never escapes the project skills root', async () => {
  const root = await makeProject('remove-traversal')
  const outside = join(root, '.dsh', 'outside.txt')
  await mkdir(join(root, '.dsh'), { recursive: true })
  await writeFile(outside, 'outside', 'utf8')

  assert.equal(await project.removeProjectLink(root, '../outside.txt'), 'not-found')
  assert.equal(await readFile(outside, 'utf8'), 'outside')
})

/* ------------------------------------------------------------------ */
/* projectDanglingLinks                                                */
/* ------------------------------------------------------------------ */

test('projectDanglingLinks returns only the dangling links', async (t) => {
  if (!DANGLING_LINKS_OBSERVABLE) {
    t.skip('this platform cannot stage a link whose target does not exist')
    return
  }
  const root = await makeProject('dangling')
  const healthy = await makeSkillDir('dangling/healthy', DEFAULT_FM)
  await link.linkAt(project.projectSkillPath(root, 'healthy'), healthy)
  await symlink(join(base, 'sources', 'dangling', 'gone'), project.projectSkillPath(root, 'gone'), 'junction')

  const found = await project.projectDanglingLinks(root)
  assert.deepEqual(found.map((f) => f.name), ['gone'])
  assert.equal(found[0]!.target, resolve(base, 'sources', 'dangling', 'gone'))
})

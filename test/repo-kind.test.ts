import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyRepo, detectDshPluginMarkers } from '../src/repo-kind.js'

/**
 * classifyRepo — repo content → kind, on real temp dirs:
 *   plain-skill | wrapped-skill | dsh-plugin | unknown
 */

let root: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-repokind-'))
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

async function repo(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel)
    await mkdir(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true })
    await writeFile(p, content, 'utf8')
  }
  return dir
}

test('SKILL.md only -> plain-skill, no markers', async () => {
  const dir = await repo('plain', { 'SKILL.md': '# s' })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'plain-skill')
  assert.deepEqual(kind.markers, [])
})

test('SKILL.md + cordis.patch.yml -> wrapped-skill', async () => {
  const dir = await repo('wrapped', {
    'SKILL.md': '# s',
    'cordis.patch.yml': '- insert: []',
  })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'wrapped-skill')
  assert.deepEqual(kind.markers, ['cordis.patch.yml'])
})

test('cordis.patch.yaml (y extension) is also a marker', async () => {
  const dir = await repo('wrapped-yaml', {
    'SKILL.md': '# s',
    'cordis.patch.yaml': '- insert: []',
  })
  const markers = await detectDshPluginMarkers(dir)
  assert.deepEqual(markers, ['cordis.patch.yaml'])
})

test('package.json#dsh.bundle.patch is a marker', async () => {
  const dir = await repo('wrapped-pkg', {
    'SKILL.md': '# s',
    'package.json': JSON.stringify({ name: 'x', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'wrapped-skill')
  assert.deepEqual(kind.markers, ['package.json#dsh.bundle.patch'])
})

test('pure DSH plugin (marker, no SKILL.md) -> dsh-plugin', async () => {
  const dir = await repo('plugin', {
    'package.json': JSON.stringify({ name: 'p', dsh: { bundle: { patch: 'x.yml' } } }),
  })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'dsh-plugin')
  assert.deepEqual(kind.markers, ['package.json#dsh.bundle.patch'])
})

test('cordis.patch.yml alone (no SKILL.md) -> dsh-plugin', async () => {
  const dir = await repo('plugin-patch', { 'cordis.patch.yml': '- insert: []' })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'dsh-plugin')
  assert.deepEqual(kind.markers, ['cordis.patch.yml'])
})

test('empty dir -> unknown', async () => {
  const dir = await repo('empty', {})
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'unknown')
  assert.deepEqual(kind.markers, [])
})

test('only a README -> unknown', async () => {
  const dir = await repo('readme-only', { 'README.md': '# readme' })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'unknown')
})

test('plain package.json without dsh marker is not a marker', async () => {
  const dir = await repo('pkg-plain', {
    'SKILL.md': '# s',
    'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
  })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'plain-skill')
  assert.deepEqual(kind.markers, [])
})

test('malformed package.json is not a marker and does not throw', async () => {
  const dir = await repo('pkg-bad', {
    'SKILL.md': '# s',
    'package.json': '{ not valid json',
  })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'plain-skill')
  assert.deepEqual(kind.markers, [])
})

test('dsh.bundle.patch with a falsy value is not a marker', async () => {
  const dir = await repo('pkg-falsy', {
    'SKILL.md': '# s',
    'package.json': JSON.stringify({ name: 'x', dsh: { bundle: {} } }),
  })
  const kind = await classifyRepo(dir)
  assert.equal(kind.kind, 'plain-skill')
  assert.deepEqual(kind.markers, [])
})

test('non-existent dir -> unknown, no markers', async () => {
  const kind = await classifyRepo(join(root, 'nope'))
  assert.equal(kind.kind, 'unknown')
  assert.deepEqual(kind.markers, [])
})

test('markerDir overrides where plugin markers are looked for (--subdir case)', async () => {
  // Skill root is a subdirectory; the plugin marker lives at the clone root.
  const dir = await repo('subdir-wrapped', {
    'skills/foo/SKILL.md': '# s',
    'cordis.patch.yml': '- insert: []',
  })
  const skillRoot = join(dir, 'skills', 'foo')

  const kind = await classifyRepo(skillRoot, { markerDir: dir })
  assert.equal(kind.kind, 'wrapped-skill')
  assert.deepEqual(kind.markers, ['cordis.patch.yml'])
})

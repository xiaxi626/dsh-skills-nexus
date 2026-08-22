import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGitSpec, repoSlug, sanitizeName } from '../src/git.js'

/* ------------------------------------------------------------------ */
/* parseGitSpec — spec → cloneable URL + ref                           */
/* ------------------------------------------------------------------ */

test('github: shorthand resolves to a GitHub https URL', () => {
  const spec = parseGitSpec('github:owner/repo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
  assert.equal(spec.ref, 'main')
})

test('custom ref fallback is used when no #ref is present', () => {
  const spec = parseGitSpec('github:owner/repo', 'master')
  assert.equal(spec.ref, 'master')
})

test('#ref overrides the fallback', () => {
  const spec = parseGitSpec('github:owner/repo#dev', 'master')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
  assert.equal(spec.ref, 'dev')
})

test('empty #ref keeps the fallback', () => {
  const spec = parseGitSpec('github:owner/repo#')
  assert.equal(spec.ref, 'main')
})

test('#ref works on full URLs too', () => {
  const spec = parseGitSpec('https://github.com/owner/repo#v1.2.3')
  assert.equal(spec.ref, 'v1.2.3')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('owner/repo shorthand expands to GitHub', () => {
  const spec = parseGitSpec('owner/repo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('bare https URL gets a .git suffix', () => {
  const spec = parseGitSpec('https://github.com/owner/repo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('https URL already ending in .git is left alone', () => {
  const spec = parseGitSpec('https://github.com/owner/repo.git')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('/tree/<ref>/... subpath is reduced to the repo root', () => {
  const spec = parseGitSpec('https://github.com/owner/repo/tree/main/skills/foo')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
  // The ref inside the tree path is *not* extracted; only #ref is.
  assert.equal(spec.ref, 'main')
})

test('git+https: scheme is stripped and normalized', () => {
  assert.equal(
    parseGitSpec('git+https://github.com/owner/repo').url,
    'https://github.com/owner/repo.git',
  )
  assert.equal(
    parseGitSpec('git+https://github.com/owner/repo.git').url,
    'https://github.com/owner/repo.git',
  )
})

test('scp-like git@ and ssh:// URLs pass through untouched', () => {
  assert.equal(
    parseGitSpec('git@github.com:owner/repo.git').url,
    'git@github.com:owner/repo.git',
  )
  assert.equal(
    parseGitSpec('ssh://git@github.com/owner/repo.git').url,
    'ssh://git@github.com/owner/repo.git',
  )
})

test('non-GitHub https host is still normalized with .git', () => {
  const spec = parseGitSpec('https://git.example.com/team/project')
  assert.equal(spec.url, 'https://git.example.com/team/project.git')
})

test('whitespace is trimmed before parsing', () => {
  const spec = parseGitSpec('  github:owner/repo  ')
  assert.equal(spec.url, 'https://github.com/owner/repo.git')
})

test('raw preserves the original input', () => {
  const input = 'github:owner/repo#dev'
  assert.equal(parseGitSpec(input).raw, input)
})

/* ------------------------------------------------------------------ */
/* repoSlug — URL → directory-usable repo name                         */
/* ------------------------------------------------------------------ */

test('repoSlug takes the last URL segment', () => {
  assert.equal(repoSlug(parseGitSpec('github:owner/repo')), 'repo')
  assert.equal(repoSlug(parseGitSpec('https://github.com/owner/skill-repo.git')), 'skill-repo')
})

test('repoSlug handles trailing slashes', () => {
  assert.equal(repoSlug(parseGitSpec('https://github.com/owner/repo/')), 'repo')
})

test('repoSlug falls back to "skill" for an empty URL', () => {
  assert.equal(repoSlug({ raw: '', url: '', ref: 'main' }), 'skill')
})

/* ------------------------------------------------------------------ */
/* sanitizeName — arbitrary text → safe directory segment              */
/* ------------------------------------------------------------------ */

test('sanitizeName lowercases and replaces unsafe characters', () => {
  assert.equal(sanitizeName('My Skill Repo!'), 'my-skill-repo')
  assert.equal(sanitizeName('UPPER'), 'upper')
})

test('sanitizeName collapses separator runs', () => {
  assert.equal(sanitizeName('a!!b'), 'a-b')
})

test('sanitizeName keeps dots, underscores and dashes', () => {
  assert.equal(sanitizeName('a.b_c-d'), 'a.b_c-d')
})

test('sanitizeName trims leading/trailing dashes', () => {
  assert.equal(sanitizeName('-foo-'), 'foo')
})

test('sanitizeName falls back to "skill" when nothing remains', () => {
  assert.equal(sanitizeName('中文名'), 'skill')
  assert.equal(sanitizeName('---'), 'skill')
  assert.equal(sanitizeName(''), 'skill')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, flag } from '../src/frontmatter.js'

/* ------------------------------------------------------------------ */
/* parseFrontmatter — SKILL.md → frontmatter + body                    */
/* ------------------------------------------------------------------ */

test('parses name and description from frontmatter', () => {
  const raw = `---
name: my-skill
description: Does a thing
---

# Body
`
  const parsed = parseFrontmatter(raw)
  assert.equal(parsed.frontmatter.name, 'my-skill')
  assert.equal(parsed.description, 'Does a thing')
  // The closing `---` regex consumes exactly one newline, so a blank line
  // before the body is preserved.
  assert.equal(parsed.body, '\n# Body\n')
})

test('description is trimmed', () => {
  const parsed = parseFrontmatter('---\ndescription: "  padded  "\n---\nbody')
  assert.equal(parsed.description, 'padded')
})

test('non-string description becomes empty string', () => {
  const parsed = parseFrontmatter('---\ndescription: 42\n---\nbody')
  assert.equal(parsed.description, '')
})

test('no frontmatter block treats the whole file as body', () => {
  const raw = '# Just markdown\n\nno frontmatter here\n'
  const parsed = parseFrontmatter(raw)
  assert.deepEqual(parsed.frontmatter, {})
  assert.equal(parsed.description, '')
  assert.equal(parsed.body, raw)
})

test('empty file parses without crashing', () => {
  const parsed = parseFrontmatter('')
  assert.deepEqual(parsed.frontmatter, {})
  assert.equal(parsed.body, '')
})

test('malformed YAML degrades to empty frontmatter, body kept', () => {
  const raw = '---\nname: [unclosed\n---\nbody text'
  const parsed = parseFrontmatter(raw)
  assert.deepEqual(parsed.frontmatter, {})
  assert.equal(parsed.description, '')
  assert.equal(parsed.body, 'body text')
})

test('non-object YAML (e.g. a scalar) degrades to empty frontmatter', () => {
  const parsed = parseFrontmatter('---\njust a string\n---\nbody')
  assert.deepEqual(parsed.frontmatter, {})
})

test('block scalar descriptions are parsed via yaml, not regex', () => {
  const raw = `---
name: skill
description: |
  Line one
  Line two
---

The body
`
  const parsed = parseFrontmatter(raw)
  assert.equal(parsed.description, 'Line one\nLine two')
  // The closing `---` regex consumes exactly one newline, so a blank line
  // before the body is preserved.
  assert.equal(parsed.body, '\nThe body\n')
})

test('CRLF line endings are handled', () => {
  const parsed = parseFrontmatter('---\r\nname: crlf-skill\r\ndescription: ok\r\n---\r\nbody\r\n')
  assert.equal(parsed.frontmatter.name, 'crlf-skill')
  assert.equal(parsed.description, 'ok')
  assert.equal(parsed.body, 'body\r\n')
})

test('unknown frontmatter fields are preserved', () => {
  const parsed = parseFrontmatter(
    '---\nname: s\nwhenToUse: only on tuesdays\nmetadata:\n  key: value\n---\nbody',
  )
  assert.equal(parsed.frontmatter.whenToUse, 'only on tuesdays')
  assert.deepEqual(parsed.frontmatter.metadata, { key: 'value' })
})

test('opening --- requires its own line', () => {
  // A markdown heading rule is not a frontmatter block.
  const parsed = parseFrontmatter('--- title\nbody')
  assert.deepEqual(parsed.frontmatter, {})
  assert.equal(parsed.body, '--- title\nbody')
})

/* ------------------------------------------------------------------ */
/* flag — optional boolean frontmatter flags                           */
/* ------------------------------------------------------------------ */

test('flag reads booleans and falls back otherwise', () => {
  assert.equal(flag({ 'user-invocable': false }, 'user-invocable', true), false)
  assert.equal(flag({ 'user-invocable': true }, 'user-invocable', true), true)
  assert.equal(flag({}, 'user-invocable', true), true)
  assert.equal(flag({ 'user-invocable': 'false' }, 'user-invocable', true), true)
  assert.equal(flag({ 'disable-model-invocation': true }, 'disable-model-invocation', false), true)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter, flag, ensureDescription } from '../src/frontmatter.js'

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

/* ------------------------------------------------------------------ */
/* ensureDescription — install-time 重写（临时目录 + 真实文件）        */
/* ------------------------------------------------------------------ */

async function withSkillFile(
  content: string,
  body: (skillFile: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-fm-'))
  const skillFile = join(dir, 'SKILL.md')
  try {
    await writeFile(skillFile, content, 'utf8')
    await body(skillFile)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const read = (skillFile: string): Promise<string> => readFile(skillFile, 'utf8')
const hasMixedEol = (s: string): boolean => s.includes('\r\n') && /(^|[^\r])\n/.test(s)

/* --- 以下 6 条修复前为红 --- */

test('ensureDescription inserts into a CRLF file', async () => {
  await withSkillFile('---\r\nname: My Skill\r\n---\r\nbody\r\n', async (f) => {
    await ensureDescription(f, 'fb')
    const out = await read(f)
    assert.equal(parseFrontmatter(out).description, 'fb')
    assert.equal(hasMixedEol(out), false)
  })
})

test('ensureDescription fills an existing empty description key instead of duplicating it', async () => {
  await withSkillFile('---\nname: foo\ndescription:\n---\nbody\n', async (f) => {
    await ensureDescription(f, 'fb')
    const out = await read(f)
    const { frontmatter, description } = parseFrontmatter(out)
    assert.equal(description, 'fb')
    // 重复键会让 parseFrontmatter 降级为 {}，故这条断言即“YAML 仍可解析”
    assert.equal(frontmatter.name, 'foo')
  })
})

test('ensureDescription fills an existing description: "" key', async () => {
  await withSkillFile('---\nname: foo\ndescription: ""\n---\nbody\n', async (f) => {
    await ensureDescription(f, 'fb')
    const { frontmatter, description } = parseFrontmatter(await read(f))
    assert.equal(description, 'fb')
    assert.equal(frontmatter.name, 'foo')
  })
})

test('ensureDescription keeps CRLF when there is no name key', async () => {
  await withSkillFile('---\r\ndisable-model-invocation: true\r\n---\r\nbody\r\n', async (f) => {
    await ensureDescription(f, 'fb')
    const out = await read(f)
    assert.equal(parseFrontmatter(out).description, 'fb')
    assert.equal(hasMixedEol(out), false)
  })
})

test('ensureDescription keeps YAML valid for a CRLF multi-line name scalar', async () => {
  await withSkillFile('---\r\nname:\r\n  My Skill\r\n---\r\nbody\r\n', async (f) => {
    await ensureDescription(f, 'fb')
    const out = await read(f)
    const { frontmatter, description } = parseFrontmatter(out)
    assert.equal(description, 'fb')
    assert.equal(frontmatter.name, 'My Skill')
    assert.equal(hasMixedEol(out), false)
  })
})

test('ensureDescription never rewrites a name: line in the Markdown body', async () => {
  const raw = '---\n"name": foo\n---\n# Doc\n\nname: example\n\nmore\n'
  await withSkillFile(raw, async (f) => {
    await ensureDescription(f, 'fb')
    const out = await read(f)
    assert.ok(
      out.endsWith('---\n# Doc\n\nname: example\n\nmore\n'),
      '闭栏之后的正文必须逐字节不变',
    )
  })
})

/* --- 以下 4 条为特征测试，修复前后均为绿（回归护栏） --- */

test('ensureDescription is a no-op when a non-empty description exists', async () => {
  const raw = '---\nname: foo\ndescription: keep\n---\nbody\n'
  await withSkillFile(raw, async (f) => {
    await ensureDescription(f, 'fb')
    assert.equal(await read(f), raw)
  })
})

test('ensureDescription inserts after name: in an LF file (byte-exact legacy output)', async () => {
  await withSkillFile('---\nname: foo\n---\nbody\n', async (f) => {
    await ensureDescription(f, 'fb')
    assert.equal(await read(f), '---\nname: foo\ndescription: "fb"\n---\nbody\n')
  })
})

test('ensureDescription prepends when there is no name key (byte-exact legacy output)', async () => {
  await withSkillFile('---\nversion: 1\n---\nbody\n', async (f) => {
    await ensureDescription(f, 'fb')
    assert.equal(await read(f), '---\ndescription: "fb"\nversion: 1\n---\nbody\n')
  })
})

test('ensureDescription is idempotent', async () => {
  await withSkillFile('---\r\nname: My Skill\r\n---\r\nbody\r\n', async (f) => {
    await ensureDescription(f, 'fb')
    const once = await read(f)
    await ensureDescription(f, 'fb')
    assert.equal(await read(f), once)
  })
})

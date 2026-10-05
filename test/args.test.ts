import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAddArgs,
  parseListArgs,
  parseRemoveArgs,
  parseToggleArgs,
  parseUpdateArgs,
  positional,
} from '../src/cli/args.js'

/* ------------------------------------------------------------------ */
/* parseAddArgs — the tiny argv parser for `add`                       */
/* ------------------------------------------------------------------ */

test('specs collects the single positional', () => {
  assert.deepEqual(parseAddArgs(['github:owner/repo']), {
    specs: ['github:owner/repo'],
    name: undefined,
    ref: undefined,
    subdir: undefined,
    yes: false,
    json: false,
  })
})

test('--subdir sets the skill root inside the repo', () => {
  const opts = parseAddArgs(['github:owner/repo', '--subdir', 'skills/foo'])
  assert.equal(opts.subdir, 'skills/foo')
  assert.equal(opts.specs[0], 'github:owner/repo')
})

test('--subdir without a value throws', () => {
  assert.throws(() => parseAddArgs(['github:owner/repo', '--subdir']), /--subdir requires a path/)
})

test('--name sets the skill name', () => {
  const opts = parseAddArgs(['github:owner/repo', '--name', 'my-skill'])
  assert.equal(opts.specs[0], 'github:owner/repo')
  assert.equal(opts.name, 'my-skill')
})

test('--ref and --branch set the ref', () => {
  assert.equal(parseAddArgs(['owner/repo', '--ref', 'dev']).ref, 'dev')
  assert.equal(parseAddArgs(['owner/repo', '--branch', 'v2']).ref, 'v2')
})

test('--yes / -y / --force set yes', () => {
  assert.equal(parseAddArgs(['owner/repo', '--yes']).yes, true)
  assert.equal(parseAddArgs(['owner/repo', '-y']).yes, true)
  assert.equal(parseAddArgs(['owner/repo', '--force']).yes, true)
})

test('options can appear before the spec', () => {
  const opts = parseAddArgs(['--yes', '--name', 'x', 'owner/repo'])
  assert.equal(opts.specs[0], 'owner/repo')
  assert.equal(opts.name, 'x')
  assert.equal(opts.yes, true)
})

test('unknown flags are ignored', () => {
  const opts = parseAddArgs(['--verbose', 'owner/repo'])
  assert.equal(opts.specs[0], 'owner/repo')
})

test('missing spec throws', () => {
  assert.throws(() => parseAddArgs([]), /missing repo spec/)
  assert.throws(() => parseAddArgs(['--yes']), /missing repo spec/)
})

test('all positionals are collected as specs, in order', () => {
  // `add A B` installs both repos; the old "last positional wins" behavior
  // silently dropped A. Multiple specs are now preserved for batch install.
  const opts = parseAddArgs(['owner/repo', 'other/repo'])
  assert.deepEqual(opts.specs, ['owner/repo', 'other/repo'])
})

/* ------------------------------------------------------------------ */
/* parseAddArgs — --flag=value equals form                             */
/* ------------------------------------------------------------------ */

test('--name=value sets the skill name', () => {
  assert.equal(parseAddArgs(['owner/repo', '--name=my-skill']).name, 'my-skill')
})

test('--ref=value and --branch=value set the ref', () => {
  assert.equal(parseAddArgs(['owner/repo', '--ref=dev']).ref, 'dev')
  assert.equal(parseAddArgs(['owner/repo', '--branch=v2']).ref, 'v2')
})

test('--subdir=path sets the subdir', () => {
  assert.equal(parseAddArgs(['owner/repo', '--subdir=skills/foo']).subdir, 'skills/foo')
})

test('--name=value and --name value are equivalent', () => {
  assert.equal(
    parseAddArgs(['owner/repo', '--name=my-skill']).name,
    parseAddArgs(['owner/repo', '--name', 'my-skill']).name,
  )
})

test('--subdir= with an empty value still throws', () => {
  assert.throws(() => parseAddArgs(['owner/repo', '--subdir=']), /--subdir requires a path/)
})

test('a value may itself contain =', () => {
  assert.equal(parseAddArgs(['owner/repo', '--name=a=b']).name, 'a=b')
})

test('a spec containing = is not split', () => {
  assert.equal(parseAddArgs(['owner/repo=v1']).specs[0], 'owner/repo=v1')
})

test('boolean flags reject an inline value', () => {
  // Without this guard inlineVal is silently discarded, so --yes=false would
  // set yes=true -- defeating both the wrapped-skill prompt (add.ts L158) and
  // the large-collection guard (add.ts L187). Throwing also removes a
  // pre-existing bug: "-y=true" does not start with "--", so today it falls
  // through to the positional branch and overwrites spec with "-y=true".
  assert.throws(() => parseAddArgs(['owner/repo', '--yes=false']), /takes no value/)
  assert.throws(() => parseAddArgs(['owner/repo', '--yes=true']), /takes no value/)
  assert.throws(() => parseAddArgs(['owner/repo', '--force=1']), /takes no value/)
  assert.throws(() => parseAddArgs(['owner/repo', '-y=true']), /takes no value/)
})

/* ------------------------------------------------------------------ */
/* positional — first non-flag argument                                */
/* ------------------------------------------------------------------ */

test('positional returns the first non-flag argument', () => {
  // `value` is the first token that does not start with "-" — the parser is
  // deliberately ignorant of which flags consume values.
  assert.equal(positional(['--flag', 'value', 'target']), 'value')
  assert.equal(positional([]), undefined)
  assert.equal(positional(['-x']), undefined)
})

/* ------------------------------------------------------------------ */
/* parseRemoveArgs — names / globs + --yes                             */
/* ------------------------------------------------------------------ */

test('parseRemoveArgs collects every name/pattern in order', () => {
  assert.deepEqual(parseRemoveArgs(['a', 'theme-*', 'b']).patterns, ['a', 'theme-*', 'b'])
  assert.equal(parseRemoveArgs(['a']).yes, false)
})

test('parseRemoveArgs keeps glob metacharacters intact', () => {
  assert.deepEqual(parseRemoveArgs(['skill-?']).patterns, ['skill-?'])
  assert.deepEqual(parseRemoveArgs(['*']).patterns, ['*'])
})

test('parseRemoveArgs detects --yes / -y / --force', () => {
  assert.equal(parseRemoveArgs(['a', '--yes']).yes, true)
  assert.equal(parseRemoveArgs(['a', '-y']).yes, true)
  assert.equal(parseRemoveArgs(['a', '--force']).yes, true)
})

test('parseRemoveArgs excludes flags from patterns', () => {
  assert.deepEqual(parseRemoveArgs(['--yes', 'a']).patterns, ['a'])
})

test('parseRemoveArgs boolean flags reject an inline value', () => {
  // Same guard as parseAddArgs: --yes=false must not silently become yes=true
  // and bypass the multi-match deletion guard in remove.ts.
  assert.throws(() => parseRemoveArgs(['a', '--yes=false']), /takes no value/)
  assert.throws(() => parseRemoveArgs(['a', '-y=1']), /takes no value/)
})

test('parseRemoveArgs with no names yields an empty pattern list', () => {
  assert.deepEqual(parseRemoveArgs([]).patterns, [])
  assert.deepEqual(parseRemoveArgs(['--yes']).patterns, [])
})

/* ------------------------------------------------------------------ */
/* parseListArgs — the names-only path for machine consumption         */
/* ------------------------------------------------------------------ */

test('parseListArgs defaults to the human table', () => {
  assert.equal(parseListArgs([]).names, false)
  assert.equal(parseListArgs([]).json, false)
})

test('--names selects the machine path', () => {
  assert.equal(parseListArgs(['--names']).names, true)
})

test('--json selects the structured machine path', () => {
  assert.equal(parseListArgs(['--json']).json, true)
  assert.equal(parseListArgs(['--json']).names, false)
})

test('parseListArgs boolean flags reject an inline value', () => {
  // Same guard as parseAddArgs/parseRemoveArgs: --names=false must not become
  // names=true, or a scripted caller asking for the table silently receives
  // the one-name-per-line stream instead. --json=false is the same class of
  // lie for the structured path.
  assert.throws(() => parseListArgs(['--names=false']), /takes no value/)
  assert.throws(() => parseListArgs(['--names=1']), /takes no value/)
  assert.throws(() => parseListArgs(['--json=false']), /takes no value/)
  assert.throws(() => parseListArgs(['--json=1']), /takes no value/)
})

test('parseListArgs rejects positionals and unknown flags', () => {
  // `list` has no positional form and no other option, so a stray token is a
  // typo rather than a target. Rejecting it (instead of ignoring it the way
  // `add` tolerates its extra options) keeps a mistyped `--name` from silently
  // printing the full table to a consumer that expects one name per line.
  assert.throws(() => parseListArgs(['foo']), /unknown argument/)
  assert.throws(() => parseListArgs(['--nope']), /unknown argument/)
})

test('parseListArgs refuses --names together with --json', () => {
  // Two machine paths with different shapes: there is no single sensible
  // answer for "names only AND the full document", so it is a usage error
  // rather than a silent precedence rule.
  assert.throws(() => parseListArgs(['--names', '--json']), /mutually exclusive/)
  assert.throws(() => parseListArgs(['--json', '--names']), /mutually exclusive/)
})

/* ------------------------------------------------------------------ */
/* parseUpdateArgs — one optional target plus the machine flag         */
/* ------------------------------------------------------------------ */

test('parseUpdateArgs defaults to every enabled entry, in human form', () => {
  assert.deepEqual(parseUpdateArgs([]), { json: false })
})

test('parseUpdateArgs takes one positional as the target', () => {
  assert.deepEqual(parseUpdateArgs(['my-skill']), { target: 'my-skill', json: false })
})

test('parseUpdateArgs accepts --json with and without a target', () => {
  // The regression this parser exists for: `update` used to read its target
  // with `positional()` and ignore every flag, so `--json` would have been
  // discarded in silence.
  assert.deepEqual(parseUpdateArgs(['--json']), { json: true })
  assert.deepEqual(parseUpdateArgs(['my-skill', '--json']), { target: 'my-skill', json: true })
})

test('parseUpdateArgs rejects an inline value, a second target and unknown flags', () => {
  assert.throws(() => parseUpdateArgs(['--json=false']), /takes no value/)
  assert.throws(() => parseUpdateArgs(['a', 'b']), /one entry name at a time/)
  assert.throws(() => parseUpdateArgs(['--yes']), /unknown argument/)
})

/* ------------------------------------------------------------------ */
/* parseToggleArgs — batch names, mirroring remove                     */
/* ------------------------------------------------------------------ */

test('parseToggleArgs collects every positional name in order', () => {
  assert.deepEqual(parseToggleArgs(['a', 'b', 'c'], 'enable'), { names: ['a', 'b', 'c'], json: false })
})

test('parseToggleArgs accepts --json before, between and after names', () => {
  assert.deepEqual(parseToggleArgs(['--json', 'a'], 'disable'), { names: ['a'], json: true })
  assert.deepEqual(parseToggleArgs(['a', '--json', 'b'], 'disable'), {
    names: ['a', 'b'],
    json: true,
  })
})

test('parseToggleArgs requires at least one name and rejects an inline value', () => {
  assert.throws(() => parseToggleArgs([], 'enable'), /missing skill name/)
  assert.throws(() => parseToggleArgs(['--json=1', 'a'], 'enable'), /takes no value/)
})

test('parseToggleArgs names the command it was invoked for', () => {
  // One parser serves both commands, so the usage wording has to come from the
  // caller — otherwise `disable --nope` would advise running `enable`.
  assert.throws(() => parseToggleArgs(['--nope'], 'disable'), /disable <name>/)
  assert.throws(() => parseToggleArgs(['--nope'], 'enable'), /enable <name>/)
  assert.throws(() => parseToggleArgs([], 'disable'), /disable <name>/)
})

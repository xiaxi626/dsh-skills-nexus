import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasMeta, globToRegExp, matchNames } from '../src/cli/glob.js'

/* ------------------------------------------------------------------ */
/* hasMeta                                                             */
/* ------------------------------------------------------------------ */

test('hasMeta detects * and ? only', () => {
  assert.equal(hasMeta('theme-*'), true)
  assert.equal(hasMeta('skill-?'), true)
  assert.equal(hasMeta('plain-name'), false)
  assert.equal(hasMeta(''), false)
})

/* ------------------------------------------------------------------ */
/* globToRegExp                                                        */
/* ------------------------------------------------------------------ */

test('globToRegExp produces an anchored RegExp', () => {
  const re = globToRegExp('a*c')
  assert.equal(re.test('abc'), true)
  assert.equal(re.test('ac'), true) // * matches zero characters
  assert.equal(re.test('xabc'), false) // anchored at start
  assert.equal(re.test('abcx'), false) // anchored at end
})

test('globToRegExp escapes regex specials so they match literally', () => {
  // A `.` in a glob is a literal dot, not "any character".
  assert.equal(globToRegExp('a.b').test('a.b'), true)
  assert.equal(globToRegExp('a.b').test('axb'), false)
})

/* ------------------------------------------------------------------ */
/* matchNames                                                          */
/* ------------------------------------------------------------------ */

test('matchNames: * matches any run of characters', () => {
  const names = ['theme-dark', 'theme-light', 'editor-vim']
  assert.deepEqual(matchNames(names, 'theme-*'), ['theme-dark', 'theme-light'])
})

test('matchNames: ? matches exactly one character', () => {
  const names = ['skill-1', 'skill-a', 'skill-10']
  assert.deepEqual(matchNames(names, 'skill-?'), ['skill-1', 'skill-a'])
})

test('matchNames: bare * matches everything', () => {
  assert.deepEqual(matchNames(['a', 'b', 'c'], '*'), ['a', 'b', 'c'])
})

test('matchNames: a literal (no meta) matches by equality, not as a regex', () => {
  const names = ['a.b', 'axb']
  assert.deepEqual(matchNames(names, 'a.b'), ['a.b'])
  // With a metacharacter, `*` still behaves as a glob.
  assert.deepEqual(matchNames(names, 'a*b'), ['a.b', 'axb'])
})

test('matchNames: anchored — no prefix/partial leakage', () => {
  const names = ['theme-dark', 'xtheme-dark']
  assert.deepEqual(matchNames(names, 'theme-*'), ['theme-dark'])
  assert.deepEqual(matchNames(names, 'heme-*'), [])
})

test('matchNames: no match returns an empty array', () => {
  assert.deepEqual(matchNames(['a', 'b'], 'zzz*'), [])
})

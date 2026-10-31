import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { SkillEntry } from '../src/types.js'
import type { EntryLink } from '../src/link.js'
import { removeTree, DANGLING_LINKS_OBSERVABLE } from './fs-helpers.js'

/**
 * Differential suite for `scanEntryLinks` (P1).
 *
 * The oracle is the **pre-change per-entry `entryLinks`**, reproduced here as
 * `referenceEntryLinks` — byte-for-byte the logic that lived in `src/link.ts`
 * before the merged scanner (same `safeRealPath` / `readLinkEntryTarget` /
 * `pointsInto` semantics, sequential per-name loop). Comparing the new thin
 * wrapper against its own bulk scanner would be self-comparison and proves
 * nothing; every fixture below asserts both
 * `deepStrictEqual(scan bucket, reference result)` and
 * `deepStrictEqual(entryLinks wrapper, reference result)` on the same,
 * unmodified fixture, so old and new must agree per entry, including order
 * and canonical target strings.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var is set before the
 * first import of the link→paths chain (same pattern as test/link.test.ts).
 * The home is staged behind a directory link (same technique as
 * test/link-canonical.test.ts) so the whole matrix also runs under an
 * ancestor `realpath` rewrites — where one is available; the rewrite test
 * asserts the precondition instead of passing vacuously.
 *
 * Test order matters once: the missing-skills-root fixture must run before
 * anything calls `linkSkill` (which creates the root). Node runs tests in a
 * file sequentially in declaration order.
 */

let realHome: string
let holder: string
let home: string
let link: typeof import('../src/link.js')
let paths: typeof import('../src/paths.js')
let external: typeof import('../src/external.js')

before(async () => {
  realHome = await mkdtemp(join(tmpdir(), 'nexus-scan-real-'))
  holder = await mkdtemp(join(tmpdir(), 'nexus-scan-holder-'))
  home = realHome
  try {
    // Stage the ancestor rewrite: DSH_HOME reached through a directory link.
    // Where `realpath` does not rewrite it back, fall through to the plain
    // home and let the rewrite test declare the platform limitation.
    const through = join(holder, 'through')
    await symlink(realHome, through, 'junction')
    if ((await realpath(through)) !== resolve(through)) home = through
  } catch {
    // cannot stage a directory link on this host — plain home
  }
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
  external = await import('../src/external.js')
})

after(async () => {
  await rm(realHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await removeTree(holder)
  delete process.env.DSH_HOME
})

/* ------------------------------------------------------------------ */
/* fixtures                                                          */
/* ------------------------------------------------------------------ */

/** Materialize a real clone directory under <repos>/ and return its path. */
async function makeRepoDir(repoPath: string, subdir?: string): Promise<string> {
  const dir = subdir ? join(paths.repoDir(repoPath), subdir) : paths.repoDir(repoPath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n', 'utf8')
  return dir
}

function managedEntry(path: string, name = path, subdir?: string): SkillEntry {
  return {
    name,
    url: `github:owner/${path}#main`,
    gitUrl: `https://github.com/owner/${path}.git`,
    ref: 'main',
    path,
    addedAt: new Date().toISOString(),
    ...(subdir ? { subdir } : {}),
  }
}

/** Mirrors what `linkLocal` registers: ownership external + externalDir. */
function externalEntry(dir: string, name: string): SkillEntry {
  return {
    name,
    url: `link:${name}`,
    gitUrl: '',
    ref: '',
    ownership: 'external',
    path: dir,
    addedAt: new Date().toISOString(),
    externalDir: dir,
  }
}

/* ------------------------------------------------------------------ */
/* the pre-change implementation, kept as the differential oracle    */
/* ------------------------------------------------------------------ */

/**
 * The old per-entry `entryLinks` verbatim (the code replaced by
 * `scanEntryLinks` in `src/link.ts`): resolve this entry's base, readdir the
 * root inside its own try/catch, then serially read, canonicalize and match
 * every name. `pointsInto` is inlined with the same body because it is
 * module-private in production — the oracle must not borrow new code.
 */
async function referenceEntryLinks(entry: SkillEntry): Promise<EntryLink[]> {
  const base = await link.safeRealPath(external.entrySkillDir(entry))
  let names: string[] = []
  try {
    names = await readdir(paths.OFFICIAL_SKILLS_DIR)
  } catch {
    return []
  }
  const links: EntryLink[] = []
  for (const name of names) {
    const target = await link.readLinkEntryTarget(paths.skillLinkPath(name))
    if (target === undefined) continue
    const resolved = await link.safeRealPath(target)
    if (resolved === base || resolved.startsWith(base + sep)) {
      links.push({ name, target: resolved })
    }
  }
  return links
}

/**
 * Run both implementations over the same untouched fixture and require
 * per-entry deep equality (order and target strings included) for the bulk
 * map AND the single-entry wrapper; returns the scan map for extra asserts.
 */
async function assertEquivalent(entries: SkillEntry[]): Promise<Map<string, EntryLink[]>> {
  const scan = await link.scanEntryLinks(entries)
  for (const entry of entries) {
    const expected = await referenceEntryLinks(entry)
    assert.deepStrictEqual(scan.get(entry.name), expected, `scan bucket for "${entry.name}"`)
    assert.deepStrictEqual(await link.entryLinks(entry), expected, `entryLinks wrapper for "${entry.name}"`)
  }
  return scan
}

/* ------------------------------------------------------------------ */
/* differential fixtures                                             */
/* ------------------------------------------------------------------ */

test('missing skills root: every entry gets an empty bucket, like the per-entry catch', async () => {
  // Precondition: nothing has created the root yet (first test in the file).
  await assert.rejects(() => lstat(paths.OFFICIAL_SKILLS_DIR), 'precondition: the skills root is absent')
  const entries = [managedEntry('no-root-a'), managedEntry('no-root-b')]
  const scan = await assertEquivalent(entries)
  assert.deepStrictEqual(scan.get('no-root-a'), [])
  assert.deepStrictEqual(scan.get('no-root-b'), [])
  // The scan is read-only: failing to read the root must not create it.
  await assert.rejects(() => lstat(paths.OFFICIAL_SKILLS_DIR), 'the scan did not create the root')
})

test('live managed, subdir and external targets bucket identically', async () => {
  const rootA = await makeRepoDir('repo-live')
  await link.linkSkill('live-a', rootA)
  const one = await makeRepoDir('repo-multi', join('skills', 'one'))
  const two = await makeRepoDir('repo-multi', join('skills', 'two'))
  await link.linkSkill('multi-one', one)
  await link.linkSkill('multi-two', two)
  const outside = await mkdtemp(join(holder, 'scan-ext-'))
  await writeFile(join(outside, 'SKILL.md'), '---\nname: x\n---\n', 'utf8')
  await link.linkSkill('ext-skill', outside)

  const entries = [
    managedEntry('repo-live'),
    managedEntry('repo-multi', 'multi-sub', join('skills', 'one')),
    externalEntry(outside, 'ext.entry'),
    managedEntry('repo-unlinked'), // directory exists, no link at all
  ]
  const scan = await assertEquivalent(entries)

  // The matrix row demands same bases/names/canonical targets/enabled — the
  // deepStrictEqual above covers all of that per entry; the concrete shapes
  // are pinned once more so a both-wrong implementation cannot pass quietly.
  assert.deepStrictEqual(scan.get('repo-live')!.map((l) => l.name), ['live-a'])
  assert.deepStrictEqual(scan.get('multi-sub')!.map((l) => l.name), ['multi-one'])
  assert.deepStrictEqual(scan.get('ext.entry')!.map((l) => l.name), ['ext-skill'])
  assert.deepStrictEqual(scan.get('repo-unlinked'), [])
  for (const bucket of scan.values()) {
    for (const l of bucket) {
      assert.equal(l.target, await realpath(l.target), 'list --json contract: target stays canonical')
    }
  }
})

test('a link under a nested parent and subdir base lands in BOTH buckets', async () => {
  const inner = await makeRepoDir('repo-nested', join('skills', 'inner'))
  await link.linkSkill('nested-inner', inner)
  const parent = managedEntry('repo-nested')
  const sub = managedEntry('repo-nested', 'repo-nested-inner', join('skills', 'inner'))

  const scan = await assertEquivalent([parent, sub])
  // First-match partitioning would drop one of these two — rule 4 forbids it.
  assert.ok(scan.get('repo-nested')!.some((l) => l.name === 'nested-inner'), 'parent bucket holds the link')
  assert.ok(scan.get('repo-nested-inner')!.some((l) => l.name === 'nested-inner'), 'subdir bucket holds the link')
})

test("a dangling link to a deleted clone keeps the reader's platform answer", async () => {
  const gone = await makeRepoDir('repo-gone', join('skills', 'gs'))
  await link.linkSkill('gone-skill', gone)
  await rm(paths.repoDir('repo-gone'), { recursive: true, force: true })
  const entry = managedEntry('repo-gone')

  // Precondition: the link really is dangling now — `realpath` refuses it.
  // The clone directory is gone too, which is the missing-clone row: the
  // base canonicalizes through the ancestor walk on both sides alike.
  assert.equal(
    await paths.resolveLinkTarget(paths.skillLinkPath('gone-skill')),
    undefined,
    'precondition: the link no longer resolves',
  )

  const scan = await assertEquivalent([entry])
  const links = scan.get('repo-gone')!
  if (DANGLING_LINKS_OBSERVABLE) {
    // POSIX: `readLinkEntryTarget` recovers the deleted target via readlink,
    // and the recovered path still points into the (missing) clone.
    assert.deepStrictEqual(links.map((l) => l.name), ['gone-skill'], 'recoverable dangling link stays attributed')
  } else {
    // Windows dangling junction: `realpath` and `readlink` both refuse it, so
    // neither implementation may invent ownership from the link name.
    assert.deepStrictEqual(links, [], 'unreadable junction is skipped, not attributed')
  }
})

test('a real directory and a plain file in the skills root follow the old predicate', async () => {
  const userDir = paths.skillLinkPath('user-dir')
  await mkdir(userDir, { recursive: true })
  await writeFile(join(userDir, 'SKILL.md'), 'user content', 'utf8')
  await writeFile(paths.skillLinkPath('plain-file'), 'x', 'utf8')

  const live = managedEntry('repo-live')
  // The sharp edge of the old predicate: an external entry whose directory
  // IS a real directory in the skills root attributes it (resolved === base).
  // The merged scan must keep that answer — it is not a new link-type filter.
  const self = externalEntry(userDir, 'self.entry')
  const scan = await assertEquivalent([live, self])

  assert.equal(scan.get('repo-live')!.some((l) => l.name === 'user-dir' || l.name === 'plain-file'), false)
  assert.ok(scan.get('self.entry')!.some((l) => l.name === 'user-dir'), 'old predicate result preserved, whatever it was')
})

test('many links: buckets keep readdir order, not completion or sort order', async () => {
  const root = await makeRepoDir('repo-many')
  for (let i = 0; i < 20; i++) {
    const seg = `s${String(i).padStart(2, '0')}`
    const dir = join(root, seg)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\n', 'utf8')
    await link.linkSkill(`many-${seg}`, dir)
  }
  const entry = managedEntry('repo-many')
  const scan = await assertEquivalent([entry])
  // Re-read the root now and require the bucket to equal the raw enumeration
  // order filtered to this entry — a different readdir order on some platform
  // changes both sides together, which is exactly the contract.
  const names = await readdir(paths.OFFICIAL_SKILLS_DIR)
  const expected = names.filter((n) => n.startsWith('many-'))
  assert.ok(expected.length >= 8, `fixture must exceed the pool size, saw ${expected.length}`)
  assert.deepStrictEqual(scan.get('repo-many')!.map((l) => l.name), expected)
})

test('scanEntryLinks([]) is an empty map', async () => {
  const scan = await link.scanEntryLinks([])
  assert.equal(scan.size, 0)
})

/* ------------------------------------------------------------------ */
/* scanner machinery: bounded pool with index-ordered results        */
/* ------------------------------------------------------------------ */

const tick = (): Promise<void> => new Promise((r) => process.nextTick(r))

test('mapBounded: reverse completion, input order out, observed concurrency <= 8', async () => {
  assert.equal(link.LINK_SCAN_CONCURRENCY, 8, 'the scan ceiling is the constant 8')
  const items = Array.from({ length: 25 }, (_, i) => i)
  let active = 0
  let maxActive = 0
  const completion: number[] = []
  const results = await link.mapBounded(items, link.LINK_SCAN_CONCURRENCY, async (i) => {
    active++
    maxActive = Math.max(maxActive, active)
    await tick()
    // Delay decreases with the index, so completion order runs against input
    // order — the exact condition the indexed assembly must survive.
    for (let k = items.length - i; k > 0; k--) await tick()
    active--
    completion.push(i)
    return i * 2
  })

  assert.deepStrictEqual(results, items.map((i) => i * 2), 'results stay in input order')
  assert.notDeepStrictEqual(completion, items, 'precondition: workers really did finish out of order')
  // The ceiling the scanner is built on, with evidence: 8 lanes all start
  // before any of their first items can finish.
  assert.ok(maxActive > 1, 'the pool actually ran concurrently — a serial run would prove nothing')
  assert.ok(maxActive <= link.LINK_SCAN_CONCURRENCY, `observed ${maxActive} in flight exceeds the ceiling ${link.LINK_SCAN_CONCURRENCY}`)
})

test('mapBounded: rejection propagates and empty input maps to empty output', async () => {
  await assert.rejects(
    () => link.mapBounded([1, 2, 3], 2, async (i) => {
      if (i === 2) throw new Error('boom')
      return i
    }),
    /boom/,
  )
  assert.deepStrictEqual(await link.mapBounded([], 8, async (i) => i), [])
})

/* ------------------------------------------------------------------ */
/* platform condition of the staged ancestor                         */
/* ------------------------------------------------------------------ */

test('the fixtures above ran under an ancestor realpath rewrites', async (t) => {
  const rewritten = (await realpath(home)) !== resolve(home)
  if (!rewritten) {
    // Explicit limitation, not a vacuous pass: this host offers no ancestor
    // rewrite (no /var-style symlink over tmpdir, and the staged directory
    // link was either unstageable or is ignored by realpath).
    t.skip('cannot stage a rewritten ancestor on this host')
    return
  }
  // Assert rewriting really occurs at the level the scanner compares paths at,
  // mirroring test/link-canonical.test.ts.
  assert.notEqual(resolve(paths.OFFICIAL_SKILLS_DIR), await realpath(paths.OFFICIAL_SKILLS_DIR))
})

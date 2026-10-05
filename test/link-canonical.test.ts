import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SkillEntry } from '../src/types.js'

/**
 * Link attribution under an ancestor that `realpath` rewrites.
 *
 * Kept in its own file on purpose: it installs a *second* DSH_HOME through a
 * cache-busted module graph, and sharing a process with the other link tests
 * would make them observe that graph.
 */

/**
 * Regression for the macOS/Windows CI failure.
 *
 * `isLinkEntry` 鈥?and therefore `hasCollision`, the `409 collision` answers in
 * `add`/`toggle`, and the link attribution `export` does 鈥?compares a
 * `realpath`-canonicalized path against the one it was handed. When the skills
 * root sits under an ancestor that `realpath` rewrites, the two strings differ
 * even for a **real directory**, so a hand-placed directory looked like a
 * nexus-owned link: safe to replace, and no collision to report.
 *
 * macOS hits this for free 鈥?`os.tmpdir()` is under `/var`, which is a symlink
 * to `/private/var` 鈥?and Windows hits it through 8.3 short-name expansion
 * (`RUNNER~1` on the hosted runners). Linux does not, which is why only two of
 * the three CI platforms ever failed. This test manufactures the condition by
 * putting the whole DSH_HOME behind a directory link, and **asserts the
 * precondition** so it can never pass vacuously.
 *
 * Skips only where the condition genuinely cannot be staged: an unelevated
 * Windows host cannot create a real directory symlink, and a junction is not
 * rewritten by `realpath` (verified on this host). Such a host is not affected
 * by this class of bug anyway 鈥?it is exactly the platform where `resolve` and
 * `realpath` agree.
 *
 * The fresh module graph is not incidental: `paths.ts` captures `DSH_HOME` at
 * import time, so the cache-busted specifier is what makes a second HOME
 * possible inside one process. `DSH_HOME` is restored immediately after the
 * import, before any assertion, so nothing else in this file can observe it.
 */
test('a real directory under a rewritten ancestor is still a collision', async () => {
  const realHome = await mkdtemp(join(tmpdir(), 'nexus-link-real-'))
  const linkHolder = await mkdtemp(join(tmpdir(), 'nexus-link-holder-'))
  const linkHome = join(linkHolder, 'through')
  try {
    await symlink(realHome, linkHome, 'junction')
  } catch {
    await rm(realHome, { recursive: true, force: true })
    await rm(linkHolder, { recursive: true, force: true })
    return // cannot stage a directory link on this host
  }

  const origHome = process.env.DSH_HOME
  let viaPaths: typeof import('../src/paths.js')
  let viaLink: typeof import('../src/link.js')
  try {
    process.env.DSH_HOME = linkHome
    const stamp = `${Date.now()}-${Math.random()}`
    viaPaths = await import(`../src/paths.js?canonical=${stamp}`)
    viaLink = await import(`../src/link.js?canonical=${stamp}`)
  } finally {
    process.env.DSH_HOME = origHome
  }

  try {
    const root = viaPaths.OFFICIAL_SKILLS_DIR
    await mkdir(root, { recursive: true })

    // The precondition is asserted, not assumed: without a rewritten ancestor
    // this test would pass trivially and prove nothing.
    assert.notEqual(
      resolve(root),
      await realpath(root),
      'precondition: the skills root must need canonicalizing',
    )

    // A real directory the user placed 鈫?still a collision.
    await mkdir(viaPaths.skillLinkPath('canon-dir'), { recursive: true })
    assert.equal(await viaLink.hasCollision('canon-dir'), true)

    // A real file 鈫?also a collision; it is not a link we may replace.
    await writeFile(viaPaths.skillLinkPath('canon-file'), 'x', 'utf8')
    assert.equal(await viaLink.hasCollision('canon-file'), true)

    // A managed link 鈫?not a collision, and still attributable.
    const repo = viaPaths.repoDir('canon-repo')
    await mkdir(repo, { recursive: true })
    await writeFile(join(repo, 'SKILL.md'), '---\nname: canon-repo\n---\n', 'utf8')
    await viaLink.linkSkill('canon-repo', repo)
    assert.equal(await viaLink.hasCollision('canon-repo'), false)

    const entry: SkillEntry = {
      name: 'canon-repo',
      url: 'github:owner/canon-repo',
      gitUrl: 'https://github.com/owner/canon-repo.git',
      ref: 'main',
      path: 'canon-repo',
      addedAt: new Date().toISOString(),
    }
    assert.equal((await viaLink.entryLinks(entry)).length, 1, 'the link is still attributed')
    assert.equal(await viaLink.isEntryEnabled(entry), true)
  } finally {
    await rm(realHome, { recursive: true, force: true })
    await rm(linkHolder, { recursive: true, force: true })
  }
})

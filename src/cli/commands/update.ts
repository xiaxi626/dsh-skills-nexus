import { readManifest, markUpdated } from '../../manifest.js'
import { skillDir } from '../../paths.js'
import {
  checkoutRef,
  getHeadCommit,
  isDetachedHead,
  pullRepo,
  resolveRefCommit,
} from '../../git.js'
import { positional } from '../args.js'

/**
 * `update [name]` — bring a skill's clone to the latest state, or verify a
 * pinned one.
 *
 * Dispatch is decided by how the clone was pinned at `add` time:
 *
 *   - branch pin (symbolic HEAD)  → `git pull --ff-only`, print the commit
 *     change (if any) and re-stamp the manifest `commit`.
 *   - tag / commit pin (detached) → a fixed point: `git pull` cannot
 *     fast-forward a detached HEAD, so never pull. Verify the checkout still
 *     matches the pin and restore it if it drifted.
 *
 * After a successful update the manifest's `commit` is re-stamped, so `list`
 * always shows the exact installed version ("lockfile-lite").
 */
export async function update(argv: string[]): Promise<number> {
  const manifest = await readManifest()
  const target = positional(argv)

  const targets = target
    ? manifest.skills.filter((s) => s.name === target)
    : manifest.skills.filter((s) => s.enabled)

  if (target && targets.length === 0) {
    process.stderr.write(`No skill named "${target}".\n`)
    return 1
  }
  if (targets.length === 0) {
    process.stdout.write('Nothing to update.\n')
    return 0
  }

  let failures = 0
  for (const s of targets) {
    const dir = skillDir(s.path)
    process.stdout.write(`Updating ${s.name} (${s.ref})…\n`)
    try {
      const before = await getHeadCommit(dir)
      let after: string

      if (await isDetachedHead(dir)) {
        // Tag / commit pin — a fixed point. Verify the pin still holds, and
        // restore the checkout if it drifted (never fast-forward).
        const want = await resolveRefCommit(dir, s.ref)
        if (before !== want) {
          await checkoutRef(dir, s.ref)
          after = await getHeadCommit(dir)
          process.stdout.write(`  ✓ restored to pinned ${short(after)}\n`)
        } else {
          after = before
          process.stdout.write(`  ✓ pinned at ${short(after)} — nothing to update\n`)
        }
      } else {
        // Branch pin — fast-forward.
        await pullRepo(dir)
        after = await getHeadCommit(dir)
        process.stdout.write(
          after === before
            ? `  ✓ up to date (${short(after)})\n`
            : `  ✓ ${short(before)} → ${short(after)}\n`,
        )
      }

      await markUpdated(s.name, after)
    } catch (err) {
      failures++
      process.stderr.write(
        `  ✗ failed: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }
  return failures === 0 ? 0 : 1
}

function short(sha: string): string {
  return sha.slice(0, 7)
}

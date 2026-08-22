import { readManifest, markUpdated, findEntry } from '../../manifest.js'
import { skillDir } from '../../paths.js'
import { pullRepo } from '../../git.js'
import { positional } from '../args.js'

/** `update [name]` — fast-forward pull one skill, or all enabled skills. */
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
    process.stdout.write(`Updating ${s.name} (${s.ref})…\n`)
    try {
      await pullRepo(skillDir(s.path))
      await markUpdated(s.name)
      process.stdout.write(`  ✓ up to date\n`)
    } catch (err) {
      failures++
      process.stderr.write(
        `  ✗ failed: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }
  return failures === 0 ? 0 : 1
}

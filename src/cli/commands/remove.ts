import { removeEntry, removeSkillDir } from '../../manifest.js'
import { positional } from '../args.js'

/** `remove <name>` — delete the cloned dir and unregister the skill. */
export async function remove(argv: string[]): Promise<number> {
  const name = positional(argv)
  if (!name) {
    process.stderr.write('Usage: dsh-skills-nexus remove <name>\n')
    return 2
  }

  const removed = await removeEntry(name)
  if (!removed) {
    process.stderr.write(`No skill named "${name}".\n`)
    return 1
  }

  await removeSkillDir(removed.path)
  process.stdout.write(`Removed "${name}" and deleted ${removed.path}/\n`)
  return 0
}

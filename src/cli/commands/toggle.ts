import { setEnabled } from '../../manifest.js'
import { positional } from '../args.js'

/** `enable <name>` / `disable <name>` — toggle catalog visibility without deleting. */
export async function toggle(argv: string[], enabled: boolean): Promise<number> {
  const name = positional(argv)
  if (!name) {
    process.stderr.write(`Usage: dsh-skills-nexus ${enabled ? 'enable' : 'disable'} <name>\n`)
    return 2
  }

  const updated = await setEnabled(name, enabled)
  if (!updated) {
    process.stderr.write(`No skill named "${name}".\n`)
    return 1
  }

  process.stdout.write(`${enabled ? 'Enabled' : 'Disabled'} "${name}".\n`)
  return 0
}

import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { withSkillFileLock } from '../../locks.js'
import { diffEntry } from '../../diff.js'

export interface DiffOptions {
  name: string
  ref?: string
  stat: boolean
}

const USAGE = 'usage: dsh-skills-nexus diff <name> [<ref>] [--stat]'

/** Parse one entry name, an optional remote ref, and the boolean --stat flag. */
export function parseDiffArgs(argv: string[]): DiffOptions {
  const positionals: string[] = []
  let stat = false

  for (const arg of argv) {
    const eqIdx = arg.indexOf('=')
    const flag = eqIdx === -1 ? arg : arg.slice(0, eqIdx)
    const inlineVal = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1)
    if (flag === '--stat') {
      if (inlineVal !== undefined) {
        throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
      }
      stat = true
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown argument "${arg}"; ${USAGE}`)
    } else {
      positionals.push(arg)
    }
  }

  if (positionals.length < 1) throw new Error(USAGE)
  if (positionals.length > 2) {
    throw new Error(`unexpected extra argument "${positionals[2]}"; ${USAGE}`)
  }
  return {
    name: positionals[0]!,
    ...(positionals[1] === undefined ? {} : { ref: positionals[1] }),
    stat,
  }
}

/** Run a read-only remote comparison while holding the entry's file lock. */
export async function diff(argv: string[], io: OpsIO = cliIO): Promise<number> {
  let options: DiffOptions
  try {
    options = parseDiffArgs(argv)
  } catch (err) {
    io.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  try {
    const result = await withSkillFileLock(options.name, () =>
      diffEntry(options.name, options.ref, options.stat),
    )
    if (result.output !== '') io.emit(result.output)
    return 0
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

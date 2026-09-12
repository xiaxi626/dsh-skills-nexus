import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

/**
 * Ask a yes/no question on the terminal.
 *
 * If stdin is not a TTY, return `defaultValue` instead of hanging — so scripts
 * and tests get a deterministic answer without blocking. Shared by `add`
 * (wrapped-repo / large-collection prompts) and `remove` (multi-match guard).
 */
export async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
  if (!input.isTTY) return defaultValue

  const rl = createInterface({ input, output })
  try {
    const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] '
    const answer = (await rl.question(question + suffix)).trim().toLowerCase()
    if (answer === 'y' || answer === 'yes') return true
    if (answer === 'n' || answer === 'no') return false
    return defaultValue
  } finally {
    rl.close()
  }
}

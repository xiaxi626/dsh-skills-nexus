#!/usr/bin/env node
/**
 * dsh-skills-nexus CLI
 *
 *   add    github:owner/repo[#ref]... [--name <name>] [--yes] [--json]
 *   list   [--names | --json]
 *   update [name] [--json]
 *   rollback <name> [--json]
 *   export <name>... | --all [--out <file>]
 *   import <package> [--dry-run] [--force]
 *   adopt  <name> --url <repo> [--ref <ref>] [--subdir <path>] [--force] [--prune]
 *   switch-version <name> <ref> [--type <branch|tag|commit>]
 *   remove <name-or-pattern>... [--yes] [--json]
 *   enable  <name>... [--json]
 *   disable <name>... [--json]
 *   doctor [--json] [--updates]
 *   completions --shell <bash|zsh|fish|powershell>
 *
 * Pure CLI tool — clones git SKILL.md repos and exposes them via symlinks
 * in the official DSH skills root (~/.dsh/skills/). The official filesystem
 * provider handles discovery, watching, and error tolerance automatically.
 */
import { add } from './commands/add.js'
import { list } from './commands/list.js'
import { update } from './commands/update.js'
import { rollback } from './commands/rollback.js'
import { exportCommand } from './commands/export.js'
import { importCommand } from './commands/import.js'
import { adopt } from './commands/adopt.js'
import { switchVersion } from './commands/switch-version.js'
import { remove } from './commands/remove.js'
import { toggle } from './commands/toggle.js'
import { doctor } from './commands/doctor.js'
import { completions } from './commands/completions.js'
import { cliIO } from '../ops-io.js'
import { printHelp } from './usage.js'

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  // The CLI half of the OpsIO seam (§4.2): every command receives cliIO
  // explicitly here, so the one place a front end picks its implementation
  // is visible in the dispatcher.
  const io = cliIO

  switch (cmd) {
    case 'add':
      return add(rest, io)
    case 'list':
    case 'ls':
      return list(rest, io)
    case 'update':
    case 'pull':
      return update(rest, io)
    case 'rollback':
      return rollback(rest, io)
    case 'export':
      return exportCommand(rest, io)
    case 'import':
      return importCommand(rest, io)
    case 'adopt':
      return adopt(rest, io)
    case 'switch-version':
      return switchVersion(rest, io)
    case 'remove':
    case 'rm':
      return remove(rest, io)
    case 'enable':
      return toggle(rest, true, io)
    case 'disable':
      return toggle(rest, false, io)
    case 'doctor':
      return doctor(rest, io)
    case 'completions':
      return completions(rest, io)
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      printHelp(io)
      return 0
    default:
      io.error(`Unknown command: ${cmd}\n`)
      printHelp(io)
      return 2
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    // The last write in the process and deliberately not routed through
    // `cliIO.error`: this catch has no command context, so it cannot know
    // whether the run was a `--json` one, and a JSON error document from here
    // would be indistinguishable from a report on a stream the caller may
    // already be parsing. A plain stderr line plus exit 1 is the documented
    // shape of an unexpected fatal (P0 §4.6).
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })

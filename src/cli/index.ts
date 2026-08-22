#!/usr/bin/env node
/**
 * dsh-skills-nexus CLI
 *
 *   add    github:owner/repo[#ref] [--name <name>]
 *   list
 *   update [name]
 *   remove <name>
 *   enable  <name>
 *   disable <name>
 *
 * This is the management surface (side effects: git clone / pull / rm). The DSH
 * provider itself never runs these — it only reads the resulting manifest +
 * cloned dirs, keeping registration read-only and idempotent.
 */
import { add } from './commands/add.js'
import { list } from './commands/list.js'
import { update } from './commands/update.js'
import { remove } from './commands/remove.js'
import { toggle } from './commands/toggle.js'

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv

  switch (cmd) {
    case 'add':
      return add(rest)
    case 'list':
    case 'ls':
      return list(rest)
    case 'update':
    case 'pull':
      return update(rest)
    case 'remove':
    case 'rm':
      return remove(rest)
    case 'enable':
      return toggle(rest, true)
    case 'disable':
      return toggle(rest, false)
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      printHelp()
      return 0
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`)
      printHelp()
      return 2
  }
}

function printHelp(): void {
  process.stdout.write(`dsh-skills-nexus — register any GitHub SKILL.md repo as a DSH skill

Usage:
  dsh-skills-nexus add    <github:owner/repo[#ref]> [--name <name>]
  dsh-skills-nexus list
  dsh-skills-nexus update [name]            # git pull (default: all enabled)
  dsh-skills-nexus remove <name>
  dsh-skills-nexus enable  <name>
  dsh-skills-nexus disable <name>

Accepted repo forms:
  github:owner/repo
  github:owner/repo#branch
  https://github.com/owner/repo
  owner/repo

State is stored at: ~/.dsh/skills-nexus/manifest.json
Clones live under:    ~/.dsh/skills-nexus/skills/<name>/
`)
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })

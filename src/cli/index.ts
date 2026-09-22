#!/usr/bin/env node
/**
 * dsh-skills-nexus CLI
 *
 *   add    github:owner/repo[#ref]... [--name <name>] [--yes]
 *   list   [--names]
 *   update [name]
 *   remove <name-or-pattern>... [--yes]
 *   enable  <name>
 *   disable <name>
 *   doctor [--json] [--updates]
 *   completions --shell <bash|zsh|fish|powershell>
 *
 * Pure CLI tool — clones GitHub SKILL.md repos and exposes them via symlinks
 * in the official DSH skills root (~/.dsh/skills/). The official filesystem
 * provider handles discovery, watching, and error tolerance automatically.
 */
import { add } from './commands/add.js'
import { list } from './commands/list.js'
import { update } from './commands/update.js'
import { remove } from './commands/remove.js'
import { toggle } from './commands/toggle.js'
import { doctor } from './commands/doctor.js'
import { completions } from './commands/completions.js'

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
    case 'doctor':
      return doctor(rest)
    case 'completions':
      return completions(rest)
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
  dsh-skills-nexus add    <github:owner/repo[#ref]>... [--name <name>] [--subdir <path>] [--yes]
  dsh-skills-nexus list [--names]
  dsh-skills-nexus update [name]            # refresh clones (default: all enabled)
  dsh-skills-nexus remove <name-or-pattern>... [--yes]
  dsh-skills-nexus enable  <name>
  dsh-skills-nexus disable <name>
  dsh-skills-nexus doctor [--json] [--updates] [--quiet]  # read-only full checkup
  dsh-skills-nexus completions --shell <bash|zsh|fish|powershell>  # print a completion script

Options:
  --name <name>     entry name (default: repo slug, or subdir's last segment)
  --ref <ref>       branch / tag / commit (same as the #ref suffix)
  --subdir <path>   install one subdirectory of a collection repo, e.g. --subdir skills/foo
  --yes             skip confirmation prompts (large collections; multi-match removal)

  list options:
  --names           print only skill names, one per line (machine-readable; used by
                    shell completion)

  doctor options:
  --json            emit a stable machine-readable report (version 1) on stdout
  --updates         also compare branch-pinned entries against their remote (network)
  --quiet           print nothing unless there is at least one error (CI convenience)

  completions options:
  --shell <name>    target shell: bash, zsh, fish or powershell

  Value options also accept --flag=value (e.g. --subdir=skills/foo); --yes takes no value.

Batch:
  add     accepts multiple repo specs: "add A B C" installs each in turn, and a
          failure on one does not abort the rest (exit code is non-zero if any
          failed). --name/--ref/--subdir are per-repo, so they cannot be combined
          with multiple specs — run separate "add" commands to customize each.
  remove  accepts multiple names plus * / ? globs matched against skill names,
          e.g. "remove 'theme-*'". A glob matching more than one skill is
          confirmed first (or pass --yes); quote it so your shell does not expand
          it. Each name is removed independently (non-zero exit if any was not
          found).

Accepted repo forms:
  github:owner/repo
  github:owner/repo#branch
  https://github.com/owner/repo
  git+https://github.com/owner/repo.git
  git@github.com:owner/repo.git        (SSH)
  ssh://git@github.com/owner/repo.git  (SSH)
  owner/repo

  An https /tree/<ref>/<path> suffix is accepted but ignored — nexus clones the
  repo root. To install a single subdirectory of a collection repo, pass
  --subdir <path>; the /tree path does not select it.

State is stored at: ~/.dsh/skills-nexus/manifest.json
Repo clones live in: ~/.dsh/skills-nexus/repos/<name>/
Skills exposed via:  ~/.dsh/skills/<name>/          (symlinks, official DSH root)
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

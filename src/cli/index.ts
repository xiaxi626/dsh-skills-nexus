#!/usr/bin/env node
/**
 * dsh-skills-nexus CLI
 *
 *   add    github:owner/repo[#ref]... [--name <name>] [--yes] [--json]
 *   list   [--names | --json]
 *   update [name] [--json]
 *   rollback <name> [--json]
 *   diff <name> [<ref>] [--stat]
 *   export <name>... | --all [--out <file>]
 *   import <package> [--dry-run] [--force]
 *   adopt  <name> --url <repo> [--ref <ref>] [--subdir <path>] [--force] [--prune]
 *   switch-version <name> <ref> [--type <branch|tag|commit>]
 *   link   <source> [--dry-run] [--group <name>] [--force] [--json]
 *   remove <name-or-pattern>... [--yes] [--json]
 *   enable  <name>... [--group <path>] [--json]
 *   disable <name>... [--group <path>] [--json]
 *   doctor [--json] [--updates]
 *   purge  [--yes] [--json]
 *   completions --shell <bash|zsh|fish|powershell>
 *
 * Pure CLI tool — clones git SKILL.md repos and exposes them via symlinks
 * in the official DSH skills root (~/.dsh/skills/). The official filesystem
 * provider handles discovery, watching, and error tolerance automatically.
 *
 * Command modules are loaded lazily (P4-2): `list` is by far the most frequent
 * invocation and the only one the panel's own refresh path drives, yet the
 * static form of this file pulled all fifteen command modules — and each one's
 * transitive graph (git, install, zip, health, …) — onto every cold start. On
 * an empty manifest `node lib/cli/index.js list` measured a ~130 ms median wall
 * clock against a ~54 ms bare-node floor, i.e. roughly 75 ms of our own module
 * load, of which ~30 ms was dead weight a `list` run never touches; routing the
 * chosen module through `import()` drops that. The always-needed `cliIO` seam
 * stays a top-level import — it is the OpsIO half of every command and loading
 * it lazily would only move cost, not remove it.
 */
import { cliIO } from '../ops-io.js'
import type { OpsIO } from '../ops-io.js'

/**
 * The dispatcher. Every command module is fetched with a dynamic `import()`
 * inside its own `case`, so a run loads only the module it routes to; the help
 * text lives in `./usage.js` and is likewise pulled in only on the help/default
 * arms. The `case` labels are scraped by `test/completions.test.ts`, so they
 * must stay one-per-line and in sync with the four shell completion templates.
 */
async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  // The CLI half of the OpsIO seam (§4.2): every command receives cliIO
  // explicitly here, so the one place a front end picks its implementation
  // is visible in the dispatcher.
  const io: OpsIO = cliIO
  // One shared help loader for the help and unknown-command arms; usage.js
  // pulls the external registry, so it stays off the command hot paths.
  const showHelp = async (): Promise<void> => {
    const { printHelp } = await import('./usage.js')
    printHelp(io)
  }

  switch (cmd) {
    case 'add':
      return (await import('./commands/add.js')).add(rest, io)
    case 'list':
    case 'ls':
      return (await import('./commands/list.js')).list(rest, io)
    case 'update':
    case 'pull':
      return (await import('./commands/update.js')).update(rest, io)
    case 'rollback':
      return (await import('./commands/rollback.js')).rollback(rest, io)
    case 'diff':
      return (await import('./commands/diff.js')).diff(rest, io)
    case 'export':
      return (await import('./commands/export.js')).exportCommand(rest, io)
    case 'import':
      return (await import('./commands/import.js')).importCommand(rest, io)
    case 'adopt':
      return (await import('./commands/adopt.js')).adopt(rest, io)
    case 'switch-version':
      return (await import('./commands/switch-version.js')).switchVersion(rest, io)
    case 'link':
      return (await import('./commands/link.js')).link(rest, io)
    case 'remove':
    case 'rm':
      return (await import('./commands/remove.js')).remove(rest, io)
    case 'enable':
      return (await import('./commands/toggle.js')).toggle(rest, true, io)
    case 'disable':
      return (await import('./commands/toggle.js')).toggle(rest, false, io)
    case 'doctor':
      return (await import('./commands/doctor.js')).doctor(rest, io)
    case 'purge':
      return (await import('./commands/purge.js')).purge(rest, io)
    case 'completions':
      return (await import('./commands/completions.js')).completions(rest, io)
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      await showHelp()
      return 0
    default:
      io.error(`Unknown command: ${cmd}\n`)
      await showHelp()
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

import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { parseImportArgs } from '../args.js'
import { ImportError, importPackage } from '../../import.js'
import type { ImportPlan, ImportPlanEntry, ImportResult } from '../../import.js'

/**
 * `import <package> [--dry-run] [--subdir <path>] [--each] [--force] ...` —
 * rebuild entries from a package (channel C of the source & migration design,
 * §4.2/§10.1/§10.3).
 *
 * Thin wrapper over `src/import.ts`: parse argv, print the plan for `--dry-run`,
 * print a summary for a real run, map failures to exit codes. Which entries end
 * up as clones and which as snapshots is decided entirely by the core, so the
 * plugin half will reuse it unchanged.
 *
 * The dry run is the contract of §10.2 — every entry is reported with one of the
 * four verdicts (clone / unreachable / timed out / source unknown) so a user
 * holding an unknown zip can tell whether it is worth importing before letting
 * anything touch their skills root.
 *
 * Exit codes: 0 = imported (or planned), 1 = failed, 2 = usage error.
 */
export async function importCommand(argv: string[], io: OpsIO = cliIO): Promise<number> {
  let options: ReturnType<typeof parseImportArgs>
  try {
    options = parseImportArgs(argv)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  try {
    const { plan, result } = await importPackage({
      source: options.source,
      dryRun: options.dryRun,
      noNetCheck: options.noNetCheck,
      noRemote: options.noRemote,
      each: options.each,
      force: options.force,
      yes: options.yes,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.subdir === undefined ? {} : { subdir: options.subdir }),
      io,
    })

    if (options.dryRun || result === undefined) {
      printPlan(plan, io)
      return 0
    }
    printSummary(result, io)
    return result.failed.length > 0 ? 1 : 0
  } catch (err) {
    if (err instanceof ImportError) {
      process.stderr.write(`${err.message}\n`)
      return 1
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

/** The `--dry-run` report (§10.2): label, peel offset, and one line per entry. */
function printPlan(plan: ImportPlan, io: OpsIO): void {
  io.emit(`package: ${plan.source} (${plan.format})\n`)
  io.emit(
    plan.labelled
      ? `manifest: ${plan.entries.length} entry(ies)`
      : 'manifest: none (source unknown)',
  )
  if (plan.peel > 0) {
    io.emit(` (peeled ${plan.peel} wrapper level(s), root: ${plan.candidate ?? '.'})`)
  }
  io.emit('\n')

  for (const entry of plan.entries) {
    io.emit(
      `  ${entry.name}  ${entry.files} file(s), ${entry.skills.length} skill(s)  ` +
        `${describe(entry)}${entry.conflict ? '  [already registered]' : ''}` +
        `${entry.enabled ? '' : '  [disabled upstream]'}\n`,
    )
  }
  for (const skipped of plan.skipped) {
    io.emit(`  ⚠ skipped by the exporting machine: "${skipped.name}" — ${skipped.reason}\n`)
  }
  if (plan.manifestOnly) {
    io.emit('  ⚠ this package lists sources but carries no skill content\n')
  }
}

function describe(entry: ImportPlanEntry): string {
  if (entry.decision.kind === 'git') {
    return `will clone from ${entry.decision.url} (${entry.decision.ref})`
  }
  switch (entry.decision.reason) {
    case 'unreachable':
      return 'will import as snapshot (remote unreachable)'
    case 'timeout':
      return 'will import as snapshot (remote check timed out)'
    case 'no-remote':
      return 'will import as snapshot (--no-remote)'
    case 'not-checked':
      return 'will import as snapshot (remote not checked)'
    default:
      return 'will import as snapshot (source unknown)'
  }
}

function printSummary(result: ImportResult, io: OpsIO): void {
  for (const entry of result.installed) {
    const how = entry.kind === 'git' ? 'cloned' : 'snapshot'
    const links = entry.links.length > 0 ? entry.links.join(', ') : '(no links — disabled upstream)'
    io.emit(`  ✓ ${entry.name}: ${how} → ${entry.path}; links: ${links}\n`)
  }
  for (const failure of result.failed) {
    process.stderr.write(`  ✗ ${failure.name}: ${failure.reason}\n`)
  }
  for (const skipped of result.skipped) {
    io.emit(`  ⚠ not in this package: "${skipped.name}" — ${skipped.reason}\n`)
  }
}

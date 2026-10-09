import { scanPurgeable, executePurge } from '../../purge.js'
import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { parsePurgeArgs } from '../args.js'
import { emitJson, fatalJsonError } from '../json-io.js'
import type { PurgeJsonReport } from '../json-types.js'

/**
 * `purge [--yes] [--json]` — clean up accumulated artifacts.
 *
 * Default mode is a dry-run: scan and report what would be deleted, but
 * touch nothing. Pass `--yes` to actually delete. The dry-run is the
 * deliberate default because the artifacts are harmless leftovers — a user
 * who runs `purge` without thinking should see what *would* go before it
 * goes.
 */
export async function purge(argv: string[], io: OpsIO = cliIO): Promise<number> {
  let yes: boolean
  let json: boolean
  try {
    const opts = parsePurgeArgs(argv)
    yes = opts.yes
    json = opts.json
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (jsonRequested(argv)) {
      fatalJsonError(io, message)
      return 2
    }
    io.error(`error: ${message}`)
    return 2
  }

  const items = await scanPurgeable()
  const totalSize = items.reduce((sum, i) => sum + i.size, 0)

  if (json) {
    if (yes) {
      const removed = await executePurge(items)
      const report: PurgeJsonReport = {
        version: 1,
        files: removed.map((i) => ({ path: i.path, size: i.size, category: i.category })),
        totalSize: removed.reduce((sum, i) => sum + i.size, 0),
        removed: removed.length,
      }
      emitJson(io, report)
    } else {
      const report: PurgeJsonReport = {
        version: 1,
        files: items.map((i) => ({ path: i.path, size: i.size, category: i.category })),
        totalSize,
        removed: 0,
      }
      emitJson(io, report)
    }
    return 0
  }

  if (items.length === 0) {
    io.emit('Nothing to purge.\n')
    return 0
  }

  if (!yes) {
    io.emit(`Found ${items.length} artifact(s) (${formatBytes(totalSize)}):\n`)
    for (const item of items) {
      io.emit(`  ${item.category}: ${item.path} (${formatBytes(item.size)})\n`)
    }
    io.emit(`\nDry run — pass --yes to delete.\n`)
    return 0
  }

  const removed = await executePurge(items)
  const removedSize = removed.reduce((sum, i) => sum + i.size, 0)
  io.emit(`Purged ${removed.length} artifact(s) (${formatBytes(removedSize)}).\n`)
  return 0
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function jsonRequested(argv: string[]): boolean {
  return argv.some((a) => a === '--json' || a.startsWith('--json='))
}

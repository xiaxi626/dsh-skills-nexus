import { readManifest } from '../../manifest.js'
import { removeSkill } from '../../remove.js'
import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { withSkillFileLock, SkillLockedError } from '../../locks.js'
import { hasMeta, matchNames } from '../glob.js'
import { parseRemoveArgs } from '../args.js'
import { emitJson, fatalJsonError, jsonIO } from '../json-io.js'
import type { RemoveJsonResult } from '../json-types.js'

/**
 * `remove <name-or-pattern>...` — delete cloned dirs, remove symlinks, and
 * unregister one or more skills.
 *
 * Accepts exact names and `*`/`?` globs (matched against registered skill
 * names). Every token is resolved to a set of names, de-duplicated, then each
 * name is removed independently: a name that isn't registered is a per-item
 * failure that does not stop the rest, and the exit code is non-zero if any
 * item failed (the same model as `update`).
 *
 * Because a glob can expand to many skills and removal is destructive
 * (deletes the clone + symlinks), a pattern that matches more than one skill is
 * guarded: the full deletion set is shown and confirmation is required unless
 * `--yes` is given. On a non-TTY (scripts) the guard cannot prompt, so it
 * refuses with exit code 2 rather than silently deleting everything matched.
 * Exact single names are unaffected — they remove immediately, as before.
 *
 * `--json` (P0 §4.4) reports one result per resolved name. The broad-glob guard
 * deliberately keeps its behaviour under `--json`: the machine `OpsIO` is
 * non-interactive, so a multi-match glob without `--yes` is still refused
 * (exit 2) rather than confirmed — a JSON run configures nothing, and
 * "silently delete everything the glob matched" is not a safer default just
 * because the caller wants structured output. Pass `--yes` to proceed.
 */
export async function remove(argv: string[], io: OpsIO = cliIO): Promise<number> {
  let patterns: string[]
  let yes: boolean
  let json: boolean
  try {
    const opts = parseRemoveArgs(argv)
    patterns = opts.patterns
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

  if (patterns.length === 0) {
    io.error('Usage: dsh-skills-nexus remove <name-or-pattern>... [--json]')
    return 2
  }

  // Machine mode: the shared code's human lines go to a silent sink so stdout
  // stays pure JSON; diagnostics keep flowing to stderr.
  const out = json ? jsonIO(io) : io

  const manifest = await readManifest()
  const allNames = manifest.skills.map((s) => s.name)

  // Resolve tokens → an ordered, de-duplicated list of names, tracking per-token
  // failures (a glob that matched nothing) and whether any single glob expanded
  // to multiple skills (which triggers the confirmation guard).
  const resolved: string[] = []
  const push = (n: string): void => {
    if (!resolved.includes(n)) resolved.push(n)
  }
  let failures = 0
  let broadGlobToken: string | undefined
  /** Per-token resolution failures, so `--json` can report them too. */
  const unresolved: string[] = []

  for (const token of patterns) {
    if (hasMeta(token)) {
      const hits = matchNames(allNames, token)
      if (hits.length === 0) {
        out.error(`No skills match pattern "${token}".`)
        failures++
        unresolved.push(token)
        continue
      }
      if (hits.length > 1 && broadGlobToken === undefined) broadGlobToken = token
      for (const h of hits) push(h)
    } else {
      push(token)
    }
  }

  // Destructive-op guard: a glob that expanded to multiple skills must be
  // confirmed. Show the *full* deletion set (globs + literals) so the user sees
  // exactly what goes. On a non-TTY we cannot prompt, so refuse (exit 2).
  if (broadGlobToken !== undefined && !yes) {
    const list = resolved.join(', ')
    if (!io.interactive) {
      const message =
        `Pattern "${broadGlobToken}" matches ${resolved.length} skills: ${list}.\n` +
        `Refusing to remove multiple skills without confirmation in a non-interactive shell.\n` +
        `Re-run with --yes to remove them.`
      if (json) {
        fatalJsonError(io, message)
        return 2
      }
      io.error(message)
      return 2
    }
    const ok = await io.confirm(
      `This will remove ${resolved.length} skill(s): ${list}.\n` +
        `Continue?`,
      false,
    )
    if (!ok) {
      out.emit('Aborted — nothing removed.\n')
      return 0
    }
  }

  if (resolved.length === 0) {
    // Every token was a zero-match glob (already reported above).
    if (json) return emitRemovalReport(io, unresolved.map(unresolvedResult))
    return failures > 0 ? 1 : 0
  }

  const results: RemoveJsonResult[] = unresolved.map(unresolvedResult)
  let removedCount = 0
  for (const name of resolved) {
    let removed: boolean
    let links: string[] = []
    try {
      // The deletion itself lives in src/remove.ts — one core shared with the
      // plugin's POST /remove route, so the two faces cannot drift apart.
      const res = await withSkillFileLock(name, () => removeSkill(name))
      removed = res.removed
      links = res.links
    } catch (err) {
      if (err instanceof SkillLockedError) {
        out.error(err.message)
        failures++
        results.push({ name, status: 'failed', error: err.message })
        continue
      }
      throw err
    }
    if (removed) {
      removedCount++
      out.emit(`Removed "${name}" — symlink(s) deleted, repo dir removed.\n`)
      results.push({ name, status: 'removed', links })
    } else {
      failures++
      out.error(`No skill named "${name}".`)
      results.push({ name, status: 'not-found' })
    }
  }

  if (json) return emitRemovalReport(io, results)

  if (resolved.length > 1) {
    out.emit(
      `\n${removedCount}/${resolved.length} skill(s) removed` +
        (failures > 0 ? `, ${failures} not found / failed` : '') +
        `.\n`,
    )
  }
  return failures === 0 ? 0 : 1
}

/** A zero-match glob token, reported as its own `not-found` item. */
function unresolvedResult(token: string): RemoveJsonResult {
  return { name: token, status: 'not-found' }
}

/** Write the `remove --json` report and derive the exit code from it. */
function emitRemovalReport(io: OpsIO, results: RemoveJsonResult[]): number {
  const failed = results.filter((r) => r.status !== 'removed').length
  emitJson(io, {
    version: 1,
    results,
    summary: { removed: results.length - failed, failed },
  })
  return failed === 0 ? 0 : 1
}

/**
 * True when the argv the parser just rejected asked for the JSON contract, so
 * a usage error still answers in the machine dialect on stderr (P0 §4.6).
 */
function jsonRequested(argv: string[]): boolean {
  return argv.some((a) => a === '--json' || a.startsWith('--json='))
}

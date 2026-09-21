import { readManifest } from '../../manifest.js'
import { REPOS_DIR, OFFICIAL_SKILLS_DIR, repoDir } from '../../paths.js'
import { stat } from 'node:fs/promises'
import { isEntryEnabled } from '../../link.js'
import { parseListArgs } from '../args.js'

/**
 * `list [--names]` — show registered skills and their status.
 *
 * `--names` is the machine path: skill names only, one per line, in manifest
 * order, with no header, padding or footer. Shell completions shell out to it
 * for the installed names instead of parsing `manifest.json`, so the CLI stays
 * the only interface to nexus state and an internal schema change cannot
 * silently break them — the same reason git completion calls `for-each-ref`
 * rather than reading `.git/refs/`. An empty manifest prints nothing on this
 * path (the human "No skills registered." hint is noise on a stream that
 * scripts split on newlines); exit stays 0.
 *
 * Exit codes: 0 = listed, 1 = manifest unreadable, 2 = usage error.
 */
export async function list(argv: string[]): Promise<number> {
  let names: boolean
  try {
    names = parseListArgs(argv).names
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  const manifest = await readManifest()

  if (names) {
    for (const s of manifest.skills) process.stdout.write(`${s.name}\n`)
    return 0
  }

  if (manifest.skills.length === 0) {
    process.stdout.write('No skills registered. Add one with: dsh-skills-nexus add github:owner/repo\n')
    return 0
  }

  const rows: string[][] = []
  for (const s of manifest.skills) {
    const dir = repoDir(s.path)
    let present = 'missing'
    try {
      await stat(dir)
      present = 'ok'
    } catch {
      present = 'missing'
    }

    const linked = await isEntryEnabled(s)
    const state = linked ? 'on ' : 'off'

    rows.push([
      state,
      s.name,
      sourceLabel(s.gitUrl || s.url),
      s.subdir ?? '—',
      s.ref,
      s.commit ? short(s.commit) : '—',
      present,
      s.updatedAt ? relative(s.updatedAt) : '—',
    ])
  }

  const nameW = Math.max(4, ...rows.map((r) => r[1]!.length))
  const srcW = Math.max(6, ...rows.map((r) => r[2]!.length))
  const subW = Math.max(6, ...rows.map((r) => r[3]!.length))
  process.stdout.write(
    `    ${'NAME'.padEnd(nameW)}  ${'SOURCE'.padEnd(srcW)}  ${'SUBDIR'.padEnd(subW)}  REF           COMMIT    DIR      UPDATED\n`,
  )
  for (const r of rows) {
    process.stdout.write(
      `${r[0]}  ${r[1]!.padEnd(nameW)}  ${r[2]!.padEnd(srcW)}  ${r[3]!.padEnd(subW)}  ${r[4]!.padEnd(13)}${r[5]!.padEnd(9)}${r[6]!.padEnd(9)}${r[7]}\n`,
    )
  }
  process.stdout.write(
    `\n${rows.length} skill(s) · repos: ${REPOS_DIR}\n` +
    `  Symlinks in: ${OFFICIAL_SKILLS_DIR} (on = linked to catalog)\n`,
  )
  return 0
}

/**
 * Derive a canonical `owner/repo` source label from a normalized git URL, so
 * entries added via different spec forms (`github:o/r`, `https://…/o/r.git`,
 * `o/r`) all group under the same string in `list`. Takes the last two
 * `/`- or `:`-delimited segments after stripping a trailing `.git`.
 *
 * Exported for unit testing — the derivation is pure (no FS, no I/O).
 */
export function sourceLabel(gitUrl: string): string {
  const segs = gitUrl.replace(/\.git$/i, '').split(/[/:]/).filter(Boolean)
  if (segs.length >= 2) return `${segs[segs.length - 2]}/${segs[segs.length - 1]}`
  return segs[0] ?? gitUrl
}

function short(sha: string): string {
  return sha.slice(0, 7)
}

function relative(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const days = Math.floor((Date.now() - then) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

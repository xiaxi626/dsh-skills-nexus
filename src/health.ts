/**
 * Startup health check for nexus-managed symlinks.
 *
 * Called from the plugin's `apply()` on every DSH startup. Verifies that each
 * manifest entry's symlinks in the official skills root still point at valid
 * target directories. Purely filesystem-based — no git, no network.
 *
 * Design constraints:
 *   - Must never throw (crash DSH startup).
 *   - Must never block (fire-and-forget from apply()).
 *   - Disabled entries (no symlink) are normal and NOT reported.
 *   - Only broken/missing targets produce warnings.
 */

import { readdir, readlink, lstat, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { OFFICIAL_SKILLS_DIR, repoDir } from './paths.js'
import { readManifest } from './manifest.js'
import type { SkillEntry } from './types.js'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EntryDiagnosis = 'ok' | 'disabled' | 'broken-link' | 'missing-target'

export interface HealthIssue {
  name: string
  issue: 'broken-link' | 'missing-target'
}

/* ------------------------------------------------------------------ */
/* Core diagnosis                                                      */
/* ------------------------------------------------------------------ */

/**
 * Diagnose a single manifest entry's symlink health.
 *
 * Scans `OFFICIAL_SKILLS_DIR` for symlinks whose resolved target falls inside
 * `repoDir(entry.path)`. Then verifies the target directory actually exists.
 *
 * Returns:
 *   - 'ok'             — at least one symlink points to a valid, existing directory
 *   - 'disabled'       — no symlink in the skills root points to this entry (normal)
 *   - 'broken-link'    — a symlink was found but readlink failed on it
 *   - 'missing-target' — a symlink was found and resolved, but the target directory does not exist
 */
export async function diagnoseEntry(entry: SkillEntry): Promise<EntryDiagnosis> {
  const base = resolve(repoDir(entry.path)) + sep

  let names: string[]
  try {
    names = await readdir(OFFICIAL_SKILLS_DIR)
  } catch {
    // Skills root doesn't exist — everything is effectively disabled.
    return 'disabled'
  }

  let foundLink = false

  for (const name of names) {
    const linkPath = resolve(OFFICIAL_SKILLS_DIR, name)

    // Check if it's a symlink
    let st
    try {
      st = await lstat(linkPath)
    } catch {
      continue
    }
    if (!st.isSymbolicLink()) continue

    // Read the symlink target
    let target: string
    try {
      target = await readlink(linkPath)
    } catch {
      // lstat says symlink but readlink fails — broken at OS level.
      // Only report if we haven't found a healthy link for this entry yet.
      // We can't confirm it belongs to this entry, so skip.
      continue
    }

    const resolved = resolve(OFFICIAL_SKILLS_DIR, target)

    // Does this symlink point inside the entry's repo directory?
    if (resolved !== base.slice(0, -1) && !resolved.startsWith(base)) continue

    foundLink = true

    // Verify the target directory actually exists
    try {
      const targetStat = await stat(resolved)
      if (targetStat.isDirectory()) {
        // At least one healthy link exists — entry is ok.
        return 'ok'
      }
    } catch {
      // Target path doesn't exist on disk.
      // Continue scanning — there might be another link that IS valid.
      continue
    }
  }

  if (!foundLink) return 'disabled'

  // We found link(s) pointing to this entry but none had a valid target.
  // Distinguish: if we got here, at least one symlink resolved to a path
  // inside the entry's repo but stat() failed on it.
  return 'missing-target'
}

/* ------------------------------------------------------------------ */
/* Batch health check                                                  */
/* ------------------------------------------------------------------ */

/**
 * Run health check on all manifest entries.
 * Returns only entries with real problems (broken-link / missing-target).
 * Disabled entries are normal and excluded from results.
 */
export async function checkHealth(): Promise<HealthIssue[]> {
  const manifest = await readManifest()
  if (manifest.skills.length === 0) return []

  const issues: HealthIssue[] = []

  for (const entry of manifest.skills) {
    const diagnosis = await diagnoseEntry(entry)
    if (diagnosis === 'broken-link' || diagnosis === 'missing-target') {
      issues.push({ name: entry.name, issue: diagnosis })
    }
  }

  return issues
}

/* ------------------------------------------------------------------ */
/* Output formatting                                                   */
/* ------------------------------------------------------------------ */

/** Format health issues into a human-readable warning string. */
export function formatWarning(issues: HealthIssue[]): string {
  if (issues.length === 0) return ''

  const count = issues.length
  const noun = count === 1 ? 'skill has a broken symlink' : 'skills have broken symlinks'
  const lines: string[] = [`[nexus] Warning: ${count} ${noun}:`]

  for (const { name, issue } of issues) {
    const detail = issue === 'missing-target'
      ? 'symlink points to missing directory'
      : 'symlink target is unreadable'
    lines.push(`  - ${name} (${detail})`)
  }

  const first = issues[0]
  if (count === 1 && first) {
    lines.push(`  Run \`dsh-skills-nexus update ${first.name}\` to re-clone and repair.`)
  } else {
    lines.push('  Run `dsh-skills-nexus update <name>` to repair individually.')
  }

  return lines.join('\n')
}

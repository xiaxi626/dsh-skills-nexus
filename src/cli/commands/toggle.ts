import { join } from 'node:path'
import { readManifest, findEntry } from '../../manifest.js'
import { repoDir } from '../../paths.js'
import { linkSkill, unlinkSkill, isEntryEnabled } from '../../link.js'
import { previewSkills } from '../../resolve.js'
import { sanitizeName } from '../../git.js'
import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { withSkillFileLock, SkillLockedError } from '../../locks.js'
import type { SkillEntry } from '../../types.js'
import { positional } from '../args.js'

/**
 * `enable <name>` / `disable <name>` — toggle catalog visibility by creating
 * or removing symlinks in the official DSH skills root.
 *
 * The actual clone stays in ~/.dsh/skills-nexus/repos/. enable/disable just
 * controls whether symlinks exist in ~/.dsh/skills/ — lightweight and atomic.
 */
export async function toggle(argv: string[], enabled: boolean, io: OpsIO = cliIO): Promise<number> {
  const name = positional(argv)
  if (!name) {
    process.stderr.write(`Usage: dsh-skills-nexus ${enabled ? 'enable' : 'disable'} <name>\n`)
    return 2
  }

  const manifest = await readManifest()
  const entry = findEntry(manifest, name)
  if (!entry) {
    process.stderr.write(`No skill named "${name}".\n`)
    return 1
  }

  const alreadyEnabled = await isEntryEnabled(entry)
  if (enabled && alreadyEnabled) {
    io.emit(`Skill "${name}" is already enabled.\n`)
    return 0
  }
  if (!enabled && !alreadyEnabled) {
    io.emit(`Skill "${name}" is already disabled.\n`)
    return 0
  }

  try {
    return await withSkillFileLock(name, () => toggleLinks(entry, name, enabled, io))
  } catch (err) {
    if (err instanceof SkillLockedError) {
      process.stderr.write(`${err.message}\n`)
      return 1
    }
    throw err
  }
}

/**
 * The symlink mutation behind enable/disable, extracted from `toggle` so it
 * runs under the per-skill cross-process lock (§7.3 layer 3). Body unchanged.
 */
async function toggleLinks(
  entry: SkillEntry,
  name: string,
  enabled: boolean,
  io: OpsIO,
): Promise<number> {
  const dir = repoDir(entry.path)
  const skillRoot = entry.subdir ? join(dir, entry.subdir) : dir

  if (enabled) {
    // Re-discover skills and create symlinks for each one.
    const skills = await previewSkills(skillRoot)
    let count = 0
    for (const s of skills) {
      const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name
      const linkName = skills.length === 1 ? entry.name : (fmName || entry.name)
      try {
        await linkSkill(linkName, s.resourceBase)
        count++
      } catch (err) {
        process.stderr.write(
          `  ⚠ failed to link "${linkName}": ${err instanceof Error ? err.message : String(err)}\n`,
        )
      }
    }
    io.emit(`Enabled "${name}" — ${count} symlink(s) created in ~/.dsh/skills/\n`)
  } else {
    // Remove symlinks — we need to know which names to unlink.
    // For single-skill repos, it's just entry.name.
    // For multi-skill repos, re-discover to find all skill names.
    const skills = await previewSkills(skillRoot)
    let count = 0
    for (const s of skills) {
      const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name
      const linkName = skills.length === 1 ? entry.name : (fmName || entry.name)
      await unlinkSkill(linkName)
      count++
    }
    // Also try the entry name itself in case it's different
    if (skills.length > 1) {
      await unlinkSkill(entry.name)
    }
    io.emit(`Disabled "${name}" — ${count} symlink(s) removed from ~/.dsh/skills/\n`)
  }

  return 0
}
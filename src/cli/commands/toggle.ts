import { join } from 'node:path'
import { readManifest, findEntry } from '../../manifest.js'
import { repoDir } from '../../paths.js'
import { linkSkill, unlinkSkill, isEntryEnabled } from '../../link.js'
import { previewSkills } from '../../resolve.js'
import { sanitizeName } from '../../git.js'
import { positional } from '../args.js'

/**
 * `enable <name>` / `disable <name>` — toggle catalog visibility by creating
 * or removing symlinks in the official DSH skills root.
 *
 * The actual clone stays in ~/.dsh/skills-nexus/repos/. enable/disable just
 * controls whether symlinks exist in ~/.dsh/skills/ — lightweight and atomic.
 */
export async function toggle(argv: string[], enabled: boolean): Promise<number> {
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
    process.stdout.write(`Skill "${name}" is already enabled.\n`)
    return 0
  }
  if (!enabled && !alreadyEnabled) {
    process.stdout.write(`Skill "${name}" is already disabled.\n`)
    return 0
  }

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
    process.stdout.write(`Enabled "${name}" — ${count} symlink(s) created in ~/.dsh/skills/\n`)
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
    process.stdout.write(`Disabled "${name}" — ${count} symlink(s) removed from ~/.dsh/skills/\n`)
  }

  return 0
}

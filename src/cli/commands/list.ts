import { readManifest } from '../../manifest.js'
import { skillDir } from '../../paths.js'
import { stat } from 'node:fs/promises'

/** `list` — show registered skills and whether their clone is present/enabled. */
export async function list(_argv: string[]): Promise<number> {
  const manifest = await readManifest()
  if (manifest.skills.length === 0) {
    process.stdout.write('No skills registered. Add one with: dsh-skills-nexus add github:owner/repo\n')
    return 0
  }

  const rows: string[][] = []
  for (const s of manifest.skills) {
    const dir = skillDir(s.path)
    let present = 'missing'
    try {
      await stat(dir)
      present = 'ok'
    } catch {
      present = 'missing'
    }
    rows.push([
      s.enabled ? 'on ' : 'off',
      s.name,
      s.ref,
      present,
      s.updatedAt ? relative(s.updatedAt) : '—',
    ])
  }

  const nameW = Math.max(4, ...rows.map((r) => r[1]!.length))
  process.stdout.write(
    `    ${'NAME'.padEnd(nameW)}  REF           DIR      UPDATED\n`,
  )
  for (const r of rows) {
    process.stdout.write(
      `${r[0]}  ${r[1]!.padEnd(nameW)}  ${r[2]!.padEnd(13)}${r[3]!.padEnd(9)}${r[4]}\n`,
    )
  }
  process.stdout.write(`\n${rows.length} skill(s) · ${SKILLS_DIR_LINE}\n`)
  return 0
}

const SKILLS_DIR_LINE = '~/.dsh/skills-nexus/skills/'

function relative(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const days = Math.floor((Date.now() - then) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'

// Locate SKILL.md files inside a cloned repo, honoring the discovery rules of
// the official filesystem provider (single-level only; nested SKILL.md under
// deep subpaths is intentionally excluded to avoid surprises).
//
// Priority:
//   1. repoRoot/SKILL.md        -> repo is a single skill (root layout)
//   2. repoRoot/<name>/SKILL.md -> repo bundles one skill per subdir
//   3. repoRoot/<name>.md       -> flat markdown (no bundled resources)
//
// resourceBase is the directory the model resolves relative paths against:
// the repo root for layout 1 and 3, the skill subdir for layout 2.

export interface LocatedSkill {
  skillFile: string
  resourceBase: string
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

export async function locateSkillFiles(dir: string): Promise<LocatedSkill[]> {
  // 1. Root SKILL.md is authoritative for the whole repo.
  const rootSkill = join(dir, 'SKILL.md')
  if (await isFile(rootSkill)) {
    return [{ skillFile: rootSkill, resourceBase: dir }]
  }

  const results: LocatedSkill[] = []
  let entries: Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  // 2. Single-level subdirectory bundles: <dir>/<name>/SKILL.md
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const sub = join(dir, entry.name)
    const candidate = join(sub, 'SKILL.md')
    if (await isFile(candidate)) {
      results.push({ skillFile: candidate, resourceBase: sub })
    }
  }

  // 3. Flat markdown files at the root: <dir>/<name>.md
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const lower = entry.name.toLowerCase()
    if (lower === 'readme.md' || lower === 'changelog.md' || lower === 'license.md') continue
    results.push({ skillFile: join(dir, entry.name), resourceBase: dir })
  }

  return results
}

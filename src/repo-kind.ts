import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { locateSkillFiles } from './locator.js'

/**
 * Classify a cloned repo before registering it with nexus.
 *
 * A repo can be:
 *  - a plain SKILL.md repo (no DSH plugin wrapper)
 *  - a SKILL.md repo wrapped by a thin DSH plugin layer
 *  - a pure DSH plugin (no SKILL.md)
 *  - unknown (neither)
 *
 * The distinction lets `add` ask before taking over a wrapped skill repo, and
 * refuse to manage pure DSH plugins through nexus.
 *
 * `markerDir` overrides where DSH plugin markers are looked for — with
 * `--subdir` installs the skill root is a subdirectory, but plugin markers
 * still live at the clone root.
 */

export type RepoKind =
  | { kind: 'plain-skill'; markers: string[] }
  | { kind: 'wrapped-skill'; markers: string[] }
  | { kind: 'dsh-plugin'; markers: string[] }
  | { kind: 'unknown'; markers: string[] }

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/**
 * Detect known DSH plugin markers at the repo root.
 *
 * The official way to make a package an installable DSH profile layer is to
 * ship a `cordis.patch.yml` and/or declare `dsh.bundle.patch` in package.json.
 * Keeping the detection conservative avoids treating arbitrary package.json
 * files as plugin markers.
 */
export async function detectDshPluginMarkers(dir: string): Promise<string[]> {
  const markers: string[] = []

  for (const name of ['cordis.patch.yml', 'cordis.patch.yaml']) {
    if (await isFile(join(dir, name))) {
      markers.push(name)
    }
  }

  const pkgPath = join(dir, 'package.json')
  if (await isFile(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        dsh?: { bundle?: { patch?: unknown } }
      }
      if (pkg.dsh?.bundle?.patch) {
        markers.push('package.json#dsh.bundle.patch')
      }
    } catch {
      // Malformed package.json is not a DSH plugin marker by itself.
    }
  }

  return markers
}

/** Classify a cloned repo based on SKILL.md presence and DSH plugin markers. */
export async function classifyRepo(
  dir: string,
  options: { markerDir?: string } = {},
): Promise<RepoKind> {
  const [located, markers] = await Promise.all([
    locateSkillFiles(dir),
    detectDshPluginMarkers(options.markerDir ?? dir),
  ])

  const hasSkill = located.length > 0
  if (hasSkill && markers.length > 0) {
    return { kind: 'wrapped-skill', markers }
  }
  if (!hasSkill && markers.length > 0) {
    return { kind: 'dsh-plugin', markers }
  }
  if (hasSkill) {
    return { kind: 'plain-skill', markers }
  }
  return { kind: 'unknown', markers }
}

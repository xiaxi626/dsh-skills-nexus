import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { detectProjectRoot } from '../project-root.js'

/**
 * Resolve the project root a `--project` command should act on.
 *
 * An explicit `--project-root` is taken literally: if it does not name an
 * existing directory the command fails instead of guessing an ancestor, because
 * a typo there would silently operate on a different project. Without it, the
 * root comes from `detectProjectRoot(cwd)` — the same nearest-`.git` rule the
 * DSH provider uses, so the command and the running session agree.
 */
export type ProjectScope = { root: string } | { error: string }

export async function resolveProjectScope(projectRoot: string | undefined): Promise<ProjectScope> {
  if (projectRoot === undefined) return { root: detectProjectRoot(process.cwd()) }

  const root = resolve(projectRoot)
  try {
    if ((await stat(root)).isDirectory()) return { root }
  } catch {
    // fall through to the shared error
  }
  return { error: `project root "${root}" does not exist or is not a directory` }
}

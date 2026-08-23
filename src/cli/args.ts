/** Tiny argv parser — keeps the CLI dependency-free. */

export interface AddOptions {
  spec: string
  name?: string
  ref?: string
  /** Path of the skill root inside the cloned repo, e.g. `skills/foo`. */
  subdir?: string
  /** Automatically accept "manage this wrapped repo via nexus" prompts. */
  yes?: boolean
}

export function parseAddArgs(argv: string[]): AddOptions {
  let spec: string | undefined
  let name: string | undefined
  let ref: string | undefined
  let subdir: string | undefined
  let yes = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--name') {
      name = argv[++i]
    } else if (a === '--ref' || a === '--branch') {
      ref = argv[++i]
    } else if (a === '--subdir') {
      subdir = argv[++i]
      if (!subdir) throw new Error('--subdir requires a path, e.g. --subdir skills/foo')
    } else if (a === '--yes' || a === '-y' || a === '--force') {
      yes = true
    } else if (!a.startsWith('--')) {
      spec = a
    }
  }

  if (!spec) {
    throw new Error('missing repo spec, e.g. github:owner/repo')
  }
  return { spec, name, ref, subdir, yes }
}

/** First positional argument, or undefined. */
export function positional(argv: string[]): string | undefined {
  return argv.find((a) => !a.startsWith('-'))
}

/** Tiny argv parser — keeps the CLI dependency-free. */

export interface AddOptions {
  spec: string
  name?: string
  ref?: string
}

export function parseAddArgs(argv: string[]): AddOptions {
  let spec: string | undefined
  let name: string | undefined
  let ref: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--name') {
      name = argv[++i]
    } else if (a === '--ref' || a === '--branch') {
      ref = argv[++i]
    } else if (!a.startsWith('--')) {
      spec = a
    }
  }

  if (!spec) {
    throw new Error('missing repo spec, e.g. github:owner/repo')
  }
  return { spec, name, ref }
}

/** First positional argument, or undefined. */
export function positional(argv: string[]): string | undefined {
  return argv.find((a) => !a.startsWith('-'))
}

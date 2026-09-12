/** Tiny argv parser — keeps the CLI dependency-free. */

export interface AddOptions {
  /**
   * Repo specs in the order given. `add` accepts one or more; the per-repo
   * options below are rejected when more than one spec is present (see add.ts),
   * because each is inherently one-to-one with a single repo.
   */
  specs: string[]
  name?: string
  ref?: string
  /** Path of the skill root inside the cloned repo, e.g. `skills/foo`. */
  subdir?: string
  /** Automatically accept "manage this wrapped repo via nexus" prompts. */
  yes?: boolean
}

export function parseAddArgs(argv: string[]): AddOptions {
  const specs: string[] = []
  let name: string | undefined
  let ref: string | undefined
  let subdir: string | undefined
  let yes = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!

    // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    if (flag === '--name') {
      name = inlineVal ?? argv[++i]
    } else if (flag === '--ref' || flag === '--branch') {
      ref = inlineVal ?? argv[++i]
    } else if (flag === '--subdir') {
      subdir = inlineVal ?? argv[++i]
      if (!subdir) throw new Error('--subdir requires a path, e.g. --subdir skills/foo')
    } else if (flag === '--yes' || flag === '-y' || flag === '--force') {
      // 布尔 flag 不接受值：静默丢弃 inlineVal 会让 --yes=false 变成 yes=true，
      // 从而同时绕过 add.ts 的 wrapped-skill 确认与 >20 skill 的大集合护栏。
      if (inlineVal !== undefined) {
        throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
      }
      yes = true
    } else if (!a.startsWith('--')) {
      // 位置参数用整段 token，含 `=` 也不拆（如 owner/repo=v1）。
      // 收集全部位置参数：`add A B` 装两个仓库，不再静默丢弃靠前的（旧行为是末位覆盖）。
      specs.push(a)
    }
  }

  if (specs.length === 0) {
    throw new Error('missing repo spec, e.g. github:owner/repo')
  }
  return { specs, name, ref, subdir, yes }
}

/** First positional argument, or undefined. */
export function positional(argv: string[]): string | undefined {
  return argv.find((a) => !a.startsWith('-'))
}

export interface RemoveOptions {
  /**
   * Name-or-pattern tokens, in order. A token containing `*` or `?` is a glob
   * matched against registered skill names (see remove.ts); any other token is
   * an exact name.
   */
  patterns: string[]
  /** Skip the "remove N skills matching <pattern>?" confirmation guard. */
  yes: boolean
}

/**
 * Parse `remove` args: one or more names/globs plus an optional `--yes`.
 *
 * Boolean flags reject an inline value for the same reason as parseAddArgs —
 * silently dropping it would turn `--yes=false` into yes=true and bypass the
 * multi-match deletion guard (remove.ts).
 */
export function parseRemoveArgs(argv: string[]): RemoveOptions {
  const patterns: string[] = []
  let yes = false

  for (const a of argv) {
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    if (flag === '--yes' || flag === '-y' || flag === '--force') {
      if (inlineVal !== undefined) {
        throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
      }
      yes = true
    } else if (!a.startsWith('-')) {
      // 名字与通配符都不以 `-` 开头（skill 名为 kebab-case），整段收集，含 `=` 也不拆。
      patterns.push(a)
    }
  }

  return { patterns, yes }
}

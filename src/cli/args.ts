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

export interface ListOptions {
  /** Print only skill names, one per line — the machine path (shell completion). */
  names: boolean
}

/**
 * Parse `list` args. `list` has no positional form and exactly one boolean flag.
 *
 * `--names` rejects an inline value for the same reason as `--yes` above:
 * `--names=false` silently becoming `names=true` would hand a scripted caller
 * the names-only stream when it asked for the human table. Unlike `add` — which
 * ignores unknown flags because it has extra options to be tolerant about —
 * unknown arguments here are usage errors: a typo like `--name` would otherwise
 * silently print the table to a script that expects one name per line.
 */
export function parseListArgs(argv: string[]): ListOptions {
  let names = false

  for (const a of argv) {
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    if (flag === '--names') {
      if (inlineVal !== undefined) {
        throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
      }
      names = true
    } else {
      throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus list [--names]`)
    }
  }

  return { names }
}

export interface ExportOptions {
  /** Entry names to package, in the order given. */
  names: string[]
  /** Package every managed entry (disabled ones included). */
  all: boolean
  /** Output path; absent means the command's default (`<name>.zip` / dated). */
  out?: string
}

/**
 * Parse `export` args: entry names or `--all`, plus an optional `--out`.
 *
 * Unlike `add` (which has per-repo options and therefore tolerates unknown
 * flags) this rejects anything it does not know: `export` writes a file whose
 * name is derived from what it was given, so a typo silently falling back to
 * "export everything" would be worse than a usage error. `--all` and explicit
 * names are mutually exclusive for the same reason — asking for one entry and
 * silently getting the whole manifest is not a recoverable surprise.
 *
 * `--out` is the only value-taking option here; `-o` is accepted as an alias
 * and is deliberately absent from `--help`'s option list (the shell templates
 * advertise long options only, matching `-y` for `--yes`).
 */
export function parseExportArgs(argv: string[]): ExportOptions {
  const names: string[] = []
  let all = false
  let out: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    if (flag === '--all') {
      if (inlineVal !== undefined) {
        throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
      }
      all = true
    } else if (flag === '--out' || flag === '-o') {
      out = inlineVal ?? argv[++i]
      if (!out) throw new Error(`${flag} requires a path, e.g. --out skills.zip`)
    } else if (!a.startsWith('-')) {
      names.push(a)
    } else {
      throw new Error(
        `unknown argument "${a}"; usage: dsh-skills-nexus export <name>... | --all [--out <file>]`,
      )
    }
  }

  if (all && names.length > 0) {
    throw new Error('--all packages every entry; do not combine it with entry names')
  }
  if (!all && names.length === 0) {
    throw new Error(
      'nothing to export; usage: dsh-skills-nexus export <name>... | --all [--out <file>]',
    )
  }
  return { names, all, out }
}

export interface ImportOptions {
  /** Package path — a `.zip` archive or a directory tree. */
  source: string
  /** Report what would happen; touch nothing. */
  dryRun: boolean
  /** Skip the remote probe entirely (offline: no waiting, no verdict). */
  noNetCheck: boolean
  /** Land everything as a snapshot, even when the label records a remote. */
  noRemote: boolean
  /** One entry per skill instead of one per candidate root. */
  each: boolean
  /** Replace an existing entry of the same name. */
  force: boolean
  /** Entry name override (single-entry packages). */
  name?: string
  /** Package-relative root, or a labelled entry's name. */
  subdir?: string
  /** Skip the large-collection confirmation during a git install. */
  yes: boolean
}

/**
 * Parse `import` args: exactly one package path plus its modifiers.
 *
 * Strict like `export` and `list`, not tolerant like `add`: every flag here
 * changes what lands on disk, and a typo that turned `--dry-run` into a real
 * import (or `--no-remote` into a clone) is not something the user can undo by
 * re-running. A second positional is rejected for the same reason — a package
 * path with a stray word after it is a mistake, not a batch.
 */
export function parseImportArgs(argv: string[]): ImportOptions {
  const positionals: string[] = []
  let dryRun = false
  let noNetCheck = false
  let noRemote = false
  let each = false
  let force = false
  let yes = false
  let name: string | undefined
  let subdir: string | undefined

  const boolean = (flag: string, inlineVal: string | undefined): void => {
    if (inlineVal !== undefined) {
      throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`)
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    switch (flag) {
      case '--dry-run':
        boolean(flag, inlineVal)
        dryRun = true
        break
      case '--no-net-check':
        boolean(flag, inlineVal)
        noNetCheck = true
        break
      case '--no-remote':
        boolean(flag, inlineVal)
        noRemote = true
        break
      case '--each':
        boolean(flag, inlineVal)
        each = true
        break
      case '--force':
        boolean(flag, inlineVal)
        force = true
        break
      case '--yes':
      case '-y':
        boolean(flag, inlineVal)
        yes = true
        break
      case '--name':
        name = inlineVal ?? argv[++i]
        if (!name) throw new Error('--name requires a name, e.g. --name my-skill')
        break
      case '--subdir':
        subdir = inlineVal ?? argv[++i]
        if (!subdir) throw new Error('--subdir requires a path, e.g. --subdir skills/foo')
        break
      default:
        if (a.startsWith('-')) {
          throw new Error(
            `unknown argument "${a}"; usage: dsh-skills-nexus import <package> [--dry-run] [--subdir <path>]`,
          )
        }
        positionals.push(a)
    }
  }

  if (positionals.length === 0) {
    throw new Error('missing package path; usage: dsh-skills-nexus import <package> [--dry-run]')
  }
  if (positionals.length > 1) {
    throw new Error(
      `import takes one package at a time (got ${positionals.length}); run it once per package`,
    )
  }

  return {
    source: positionals[0]!,
    dryRun,
    noNetCheck,
    noRemote,
    each,
    force,
    ...(name === undefined ? {} : { name }),
    ...(subdir === undefined ? {} : { subdir }),
    yes,
  }
}

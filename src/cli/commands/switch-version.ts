import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { withSkillFileLock, SkillLockedError } from '../../locks.js'
import { findEntry, readManifest } from '../../manifest.js'
import {
  NotAGitCloneError,
  RefNotFoundError,
  SkillNotFoundError,
  switchVersion as coreSwitchVersion,
} from '../../switch-version.js'
import type { SwitchVersionResult } from '../../switch-version.js'
import { withSpinner } from '../progress.js'

/**
 * `switch-version <name> <ref> [--type <branch|tag|commit>]` — move an
 * entry's clone to another branch / tag / commit.
 *
 * The orchestration is `src/switch-version.ts` (§8.2: fetch → verify →
 * checkout → re-normalize frontmatter → rebuild links, with rollback); this
 * wrapper parses argv, keeps a spinner running while the core works, and maps
 * the core's error classes to exit codes:
 *   0 = switched, 1 = no such skill / ref not found / no git source / other
 *   failure, 2 = usage error.
 *
 * `--type` is the caller's hint (§8.2): the fetch result decides the checkout
 * style, and the hint only orders the offline fallback when nothing landed —
 * every namespace is then tried against the local clone, hint first. Like
 * `refType` in the API it is never persisted.
 *
 * Like `update`, the switch discards local changes in the clone: managed
 * clones are dirty by convention (install-time normalization rewrites
 * SKILL.md), and the core warns before it discards (matching `update`'s text).
 */

/** Values `--type` accepts — the same transient hint the core takes. */
export const SUPPORTED_REF_TYPES = ['branch', 'tag', 'commit'] as const
export type RefTypeHint = (typeof SUPPORTED_REF_TYPES)[number]

export interface SwitchVersionOptions {
  name: string
  ref: string
  refType?: RefTypeHint
}

const USAGE =
  'usage: dsh-skills-nexus switch-version <name> <ref> [--type <branch|tag|commit>]'

/**
 * Parse `switch-version` args: exactly two positionals (`<name> <ref>`) plus
 * an optional `--type` value option (`--type tag` / `--type=tag`, the form
 * every value option in this CLI accepts).
 *
 * An unknown flag, a missing/extra positional or an unknown `--type` value is
 * a usage error — never a silent guess: a typo like `--typ tag` must not
 * silently switch the entry under an unintended interpretation.
 */
export function parseSwitchVersionArgs(argv: string[]): SwitchVersionOptions {
  const positionals: string[] = []
  let refType: RefTypeHint | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
    const eqIdx = a.indexOf('=')
    const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a
    const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined

    if (flag === '--type') {
      const val = inlineVal ?? argv[++i]
      if (!val) {
        throw new Error(`--type requires a value; one of: ${SUPPORTED_REF_TYPES.join(', ')}`)
      }
      if (!(SUPPORTED_REF_TYPES as readonly string[]).includes(val)) {
        throw new Error(
          `unsupported --type "${val}"; supported: ${SUPPORTED_REF_TYPES.join(', ')}`,
        )
      }
      refType = val as RefTypeHint
    } else if (!a.startsWith('-')) {
      // 名字与 ref 都不以 `-` 开头；整段收集，含 `=` 也不拆。
      positionals.push(a)
    } else {
      throw new Error(`unknown argument "${a}"; ${USAGE}`)
    }
  }

  if (positionals.length < 2) {
    throw new Error(USAGE)
  }
  if (positionals.length > 2) {
    throw new Error(`unexpected extra argument "${positionals[2]}"; ${USAGE}`)
  }
  return { name: positionals[0]!, ref: positionals[1]!, refType }
}

export async function switchVersion(argv: string[], io: OpsIO = cliIO): Promise<number> {
  let opts: SwitchVersionOptions
  try {
    opts = parseSwitchVersionArgs(argv)
  } catch (err) {
    io.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  // Reject an unknown name before the banner: `update` prints nothing on
  // stdout for an unknown target, and a "Switching…" line immediately
  // followed by "no such skill" on stderr reads like work was done. The core
  // still re-checks and throws SkillNotFoundError; this is the friendly path.
  const manifest = await readManifest()
  if (!findEntry(manifest, opts.name)) {
    io.error(`No skill named "${opts.name}".`)
    return 1
  }

  io.emit(`Switching "${opts.name}" to ${opts.ref}…\n`)
  let result: SwitchVersionResult
  try {
    result = await withSpinner(
      `switching ${opts.name} → ${opts.ref}`,
      () =>
        withSkillFileLock(opts.name, () =>
          coreSwitchVersion(opts.name, opts.ref, opts.refType, io),
        ),
    )
  } catch (err) {
    // The core's error classes carry complete, user-readable messages (§8.2);
    // anything else is an unexpected failure and keeps the `error:` prefix.
    if (
      err instanceof SkillNotFoundError ||
      err instanceof RefNotFoundError ||
      err instanceof NotAGitCloneError ||
      err instanceof SkillLockedError
    ) {
      io.error(err.message)
      return 1
    }
    io.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  io.emit(
    `  ✓ ${short(result.before)} → ${short(result.after)} ` +
      `(${result.kind === 'branch' ? 'branch' : 'pinned'})\n`,
  )
  if (result.links.length > 0) {
    io.emit(`  symlinks: ${result.links.length} skill(s) rebuilt in ~/.dsh/skills/\n`)
  }
  return 0
}

function short(sha: string): string {
  return sha.slice(0, 7)
}

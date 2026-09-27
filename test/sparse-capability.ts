import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether this machine's Git can run the sparse install flow.
 *
 * The judgement mirrors `sparseSetCapabilities` in `src/git.ts`: Git must
 * advertise `--cone` on `sparse-checkout set -h` (offered since Git 2.35,
 * Jan 2022). An older Git is not an error state — `cloneRepo` deliberately
 * completes the clone as a full checkout instead — so the sparse integration
 * tests are gated on this probe and *skip* where the sparse flow cannot run,
 * rather than fail on a behaviour the design calls correct. Ubuntu 22.04 LTS
 * (supported into 2027) still ships Git 2.34.1, so that branch is a live
 * environment, not a legacy afterthought; the degradation path itself is
 * covered against a patched Git in `test/git-sparse-probe.test.ts`.
 *
 * The probe must never fail silently: a broken probe would turn every sparse
 * integration test green-by-skip. So when the help text claims "no --cone"
 * while `git --version` says 2.35+, the disagreement throws.
 */

/** Mirrors the `--cone` check in `src/git.ts`. */
export function sparseSetAdvertisesCone(helpText: string): boolean {
  return /--(?:\[no-\])?cone\b/.test(helpText)
}

function runGit(args: string[], cwd?: string): string {
  const { error, stdout, stderr } = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  })
  if (error) throw error
  return (stdout ?? '') + (stderr ?? '')
}

function gitIsAtLeast235(): boolean | null {
  const match = /git version (\d+)\.(\d+)/.exec(runGit(['--version']))
  if (match === null) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 2 || (major === 2 && minor >= 35)
}

function detectConeSupport(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'nexus-sparse-capability-'))
  try {
    // A subcommand's help requires a repository — probe in a throwaway one,
    // the same reason `cloneRepo` probes inside the fresh clone.
    const init = spawnSync('git', ['init', '--quiet'], { cwd: probe, encoding: 'utf8' })
    if (init.status !== 0) {
      throw new Error(`git init failed while probing sparse capabilities: ${init.stderr ?? ''}`)
    }
    const hasCone = sparseSetAdvertisesCone(runGit(['sparse-checkout', 'set', '-h'], probe))
    if (!hasCone && gitIsAtLeast235() === true) {
      throw new Error(
        '`git --version` reports 2.35+ but `sparse-checkout set -h` shows no --cone; ' +
          'update the probe in test/sparse-capability.ts (refusing to skip silently)',
      )
    }
    return hasCone
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/** `skip` value for the sparse integration tests; `false` = run normally. */
export const SPARSE_SKIP: false | string = detectConeSupport()
  ? false
  : 'needs Git 2.35+ (cone-mode sparse-checkout); older Git falls back to a full clone by design'

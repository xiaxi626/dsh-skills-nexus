import { readdir, realpath, rm, rmdir } from 'node:fs/promises'
import {
  lstatSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Shared filesystem helpers for the test suite.
 *
 * Everything here exists for one platform reason, documented once instead of
 * three times: **Windows reports an NTFS junction as an ordinary directory, and
 * `rm -r` cannot delete a dangling one.**
 *
 * `src/link.ts` creates junctions (a real directory symlink needs a privilege
 * junctions do not), and several fixtures deliberately leave one pointing at a
 * directory they then delete. Node's `rm(path, { recursive: true })` walks into
 * the reparse point, finds nothing there, and fails with `ENOTEMPTY` — so it
 * removes every sibling and leaves the link behind, which makes the *next*
 * test's "start from a clean skills root" fail. `rmdir` removes such a link
 * directly and never descends into it.
 *
 * This is fixture plumbing, not production behaviour: `src/link.ts` has its own
 * `removeLinkEntry` for the same reason, and is the thing under test.
 */

/**
 * Recursively delete `dir` (or do nothing when it is absent), first removing
 * any link inside it that resolves nowhere.
 *
 * The dangling-link test is a two-step proof, because a Windows junction is
 * indistinguishable from a directory by inspection alone:
 *
 *   1. `realpath` fails → either a dangling link, or a path whose ancestor is
 *      gone. A real directory with content always resolves;
 *   2. `rmdir` succeeds → it was an empty directory or a link. A real populated
 *      directory refuses with `ENOTEMPTY`/`EPERM` and is left for `rm`.
 *
 * Step 2 is what stops this from deleting fixture content.
 */
export async function removeTree(dir: string): Promise<void> {
  await removeDanglingLinks(dir)
  await rm(dir, { recursive: true, force: true })
}

/** Remove every entry directly inside `dir` that resolves nowhere. */
export async function removeDanglingLinks(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    try {
      await realpath(path)
      continue // resolves fine — not our case
    } catch {
      // Unresolvable. `rmdir` is the one primitive that removes a link without
      // following it; it refuses a populated real directory, which is exactly
      // the case we must not touch.
      await rmdir(path).catch(() => undefined)
    }
  }
}

/**
 * Whether the suite can stage *and* observe a link whose target has been
 * deleted — the precondition of the dangling-link diagnostics tests.
 *
 * False on Windows for two independent reasons, both measured below rather than
 * assumed:
 *
 *   1. `symlink(..., 'junction')` refuses a target that does not exist, so the
 *      fixture cannot even be built;
 *   2. a junction whose target is deleted later is refused by `realpath`
 *      (ENOENT) *and* by `readlink` (EINVAL), while `lstat` reports an ordinary
 *      directory — so no reader the production code has could classify it.
 *
 * POSIX symlinks satisfy both, which is why these assertions exist and pass
 * there. The removal path does not depend on the distinction: `rmdir` deletes
 * such a link on every platform (see `test/link.test.ts`).
 */
export const DANGLING_LINKS_OBSERVABLE: boolean = probeDanglingLinks()

function probeDanglingLinks(): boolean {
  const base = mkdtempSync(join(tmpdir(), 'nexus-probe-dangling-'))
  const link = join(base, 'link')
  try {
    try {
      symlinkSync(join(base, 'missing-target'), link, 'junction')
    } catch {
      // Windows refuses to create a junction whose target does not exist, so
      // the situation these tests describe cannot be staged there at all.
      return false
    }
    try {
      realpathSync(link)
      return true // resolved — the target evidently is not missing
    } catch {
      // fall through to the remaining readers
    }
    try {
      readlinkSync(link)
      return true
    } catch {
      // realpath and readlink both refused
    }
    try {
      return lstatSync(link).isSymbolicLink()
    } catch {
      return false
    }
  } finally {
    // `rmdir` because `rm -r` cannot delete a dangling junction — the very
    // quirk this probe is about.
    try {
      rmdirSync(link)
    } catch {
      // never created, or already gone
    }
    try {
      rmSync(base, { recursive: true, force: true })
    } catch {
      // best effort — a temp dir
    }
  }
}

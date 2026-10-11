/**
 * Purge accumulated artifacts that are safe to delete but have no automatic
 * cleanup mechanism.
 *
 * Four categories of residue grow over time:
 *   1. `exports/*.zip`         — every `export` writes a new archive; old ones
 *                                are never garbage-collected.
 *   2. `manifest.json.corrupt-*` — the atomic-write backup from a corrupt
 *                                manifest read; each corruption event leaves
 *                                one behind.
 *   3. `upload-*`              — temporary directories created during package
 *                                import; a crash between `mkdir` and `rm`
 *                                leaves them orphaned.
 *   4. `rollback/<name>.json`  — recovery points for removed skills. Active
 *                                skills' rollback files are *not* touched:
 *                                they still serve `rollback <name>`.
 *
 * The default mode is a dry-run: scan and report, but delete nothing. This is
 * deliberate — the artifacts are harmless leftovers, and a user who runs
 * `purge` without `--yes` gets a preview of what *would* go. Actual deletion
 * requires an explicit `--yes`, the same guard pattern as `remove` with
 * multi-match globs.
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { NEXUS_HOME } from './paths.js'
import { readManifest } from './manifest.js'

/**
 * mtime 保护窗口：最近 24 小时内修改过的候选目录不被 purge 清除。
 *
 * 一个刚被 `git fetch` / `git pull` / 手动 checkout touched 的目录，其
 * mtime 是新鲜的，但 manifest 可能因为别的原因（手动编辑、另一个进程的
 * 并发操作）不再引用它——直接删除会丢失用户刚做的工作。24 小时足以覆盖
 * "今天刚用过"的场景，同时不会让真正的孤儿目录长期驻留。
 */
export const PURGE_MTIME_GUARD_MS = 24 * 60 * 60 * 1000

/** One file the purge scan identified, with its size in bytes. */
export interface PurgeableItem {
  /** Absolute path of the file or directory to remove. */
  path: string
  /** Size in bytes (for directories, the sum of all descendants). */
  size: number
  /** Which category this item belongs to — feeds the JSON report. */
  category: 'exports' | 'corrupt-manifest' | 'upload-temp' | 'orphan-rollback'
}

/**
 * Scan the four artifact categories and return every purgeable item.
 *
 * Exported for the CLI's dry-run and the `--json` report. Pure scan — no
 * side effects, nothing is deleted.
 */
export async function scanPurgeable(): Promise<PurgeableItem[]> {
  const items: PurgeableItem[] = []

  // 1. exports/*.zip
  const exportsDir = join(NEXUS_HOME, 'exports')
  for (const name of await listDir(exportsDir)) {
    if (name.endsWith('.zip')) {
      const p = join(exportsDir, name)
      items.push({ path: p, size: await fileSize(p), category: 'exports' })
    }
  }

  // 2. manifest.json.corrupt-*
  for (const name of await listDir(NEXUS_HOME)) {
    if (name.startsWith('manifest.json.corrupt-')) {
      const p = join(NEXUS_HOME, name)
      items.push({ path: p, size: await fileSize(p), category: 'corrupt-manifest' })
    }
  }

  // 3. upload-*
  for (const name of await listDir(NEXUS_HOME)) {
    if (name.startsWith('upload-')) {
      const p = join(NEXUS_HOME, name)
      items.push({ path: p, size: await dirSize(p), category: 'upload-temp' })
    }
  }

  // 4. orphan rollback files — name not in the current manifest
  const manifest = await readManifest()
  const activeNames = new Set(manifest.skills.map((s) => s.name))
  const rollbackDir = join(NEXUS_HOME, 'rollback')
  for (const name of await listDir(rollbackDir)) {
    if (!name.endsWith('.json')) continue
    const entryName = name.slice(0, -5) // strip .json
    if (activeNames.has(entryName)) continue // active skill — keep its rollback
    const p = join(rollbackDir, name)
    items.push({ path: p, size: await fileSize(p), category: 'orphan-rollback' })
  }

  return items
}

/**
 * Result of {@link executePurge}: what was actually deleted and what the mtime
 * guard spared.
 */
export interface PurgeResult {
  /** Items successfully removed. */
  removed: PurgeableItem[]
  /**
   * Items spared because their mtime falls within the protection window.
   * The caller can surface these so the user knows they exist but were kept.
   */
  skippedRecent: PurgeableItem[]
}

/**
 * Delete every item the scan returned. Errors are swallowed per-item so one
 * stubborn file does not abort the rest — the caller reports what was
 * actually removed via the return value.
 *
 * Items whose mtime falls within {@link PURGE_MTIME_GUARD_MS} of now are
 * spared: a directory touched in the last 24 hours is likely still in active
 * use, even if no manifest entry currently references it. `stat` failure
 * (directory vanished between scan and delete) does NOT trigger the guard —
 * `catch(() => undefined)` falls through to the normal `rm` path, which will
 * also fail and be swallowed by the per-item try/catch.
 */
export async function executePurge(items: PurgeableItem[]): Promise<PurgeResult> {
  const removed: PurgeableItem[] = []
  const skippedRecent: PurgeableItem[] = []
  for (const item of items) {
    // mtime guard: skip items modified within the protection window.
    // A `stat` failure means the item already vanished — let `rm` handle it
    // (it will no-op via `force: true`).
    const st = await stat(item.path).catch(() => undefined)
    if (st && Date.now() - st.mtimeMs < PURGE_MTIME_GUARD_MS) {
      skippedRecent.push(item)
      continue
    }
    try {
      await rm(item.path, { recursive: true, force: true })
      removed.push(item)
    } catch {
      // A file that vanished between scan and delete, or a permission error,
      // is not worth aborting the whole purge over. The dry-run preview
      // already told the user what we intended; the JSON report shows what
      // actually happened.
    }
  }
  return { removed, skippedRecent }
}

/** List a directory's entries, or an empty array when it does not exist. */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/** File size in bytes, or 0 when the path does not exist. */
async function fileSize(path: string): Promise<number> {
  try {
    const s = await stat(path)
    return s.size
  } catch {
    return 0
  }
}

/**
 * Recursive directory size. Walks the tree with `readdir` + `stat` rather
 * than shelling out, so the purge stays dependency-free and cross-platform.
 */
async function dirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await readdir(dir)
    for (const name of entries) {
      const p = join(dir, name)
      try {
        const s = await stat(p)
        if (s.isDirectory()) total += await dirSize(p)
        else total += s.size
      } catch {
        // Unreadable entry — count nothing; the delete will report it.
      }
    }
  } catch {
    // Directory vanished between scan and size — harmless.
  }
  return total
}

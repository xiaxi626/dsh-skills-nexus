import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { findEntry, isExternalEntry, readManifest } from './manifest.js'
import { repoDir } from './paths.js'
import { entryLinks } from './link.js'
import { previewSkills } from './resolve.js'
import { createZip } from './zip.js'
import { sanitizeName } from './git.js'
import type { OpsIO } from './ops-io.js'
import type { SkillEntry } from './types.js'
import type { ZipInputFile } from './zip.js'

/**
 * `export` — channel C of the sources & packages design
 * (`docs/sources-and-packages.md`): turn one or more registered
 * entries into a portable package.
 *
 * A package is a transport container, **not** a second install format. It
 * carries the skill files *and* a `nexus-package.json` label recording where
 * each entry came from (`url` / `gitUrl` / `ref` / `commit` / `subdir`), whether
 * it was enabled, and which links it owned. The importer prefers to re-fetch
 * from that recorded source; the files are the fallback. That is the whole
 * point of the label: a bare directory can never be turned back into an
 * updatable entry, a labelled package can.
 *
 * Two rules follow from "the label is the value, the files are the fallback":
 *
 *   - **no `.git` and no credentials** ever enter a package. History is not
 *     what makes an entry updatable here — a recorded remote is — and shipping
 *     a clone would smuggle `.git/config` credentials into a file the user is
 *     about to hand to someone else;
 *   - **external entries are never exported.** An `ownership: 'external'` entry
 *     only links a directory the user owns; copying it would cross the one
 *     boundary the marker exists to protect. `--all` records it in `skipped[]`,
 *     asking for it by name is an error.
 */

/** Label schema id written into every package. */
export const PACKAGE_SCHEMA = 'dsh-skills-nexus/package'
/** Label schema version; a reader must refuse a higher one. */
export const PACKAGE_VERSION = 1
/** File name of the label inside the package. */
export const PACKAGE_MANIFEST = 'nexus-package.json'

/** One skill the package carries, as the exporter saw it. */
export interface PackageSkill {
  /** Skill root inside the package, e.g. `skills/foo/bar` (`.` root → entry root). */
  root: string
  /** Skill name the importer should use when rebuilding links. */
  name: string
  description: string
  /** Link names that existed when the entry was exported (may be empty). */
  links: string[]
}

/** One entry inside a package — the label's unit. */
export interface PackageEntry {
  /** Entry name (also the directory name under `skills/`). */
  name: string
  /** Spec the user originally passed, e.g. `github:owner/repo#main`. */
  url: string
  /** Resolved remote; empty for entries nexus never cloned from git. */
  gitUrl: string
  ref: string
  /** Informational only — the importer re-resolves `ref` instead of trusting it. */
  commit: string
  subdir?: string
  /** Whether the entry had at least one link when it was exported. */
  enabled: boolean
  skills: PackageSkill[]
}

/** An entry deliberately left out of the package, and why. */
export interface PackageSkipped {
  name: string
  reason: string
}

/** The package label (`nexus-package.json`). */
export interface NexusPackage {
  schema: string
  version: number
  exportedAt: string
  generator: string
  skipped: PackageSkipped[]
  entries: PackageEntry[]
}

/** `export` could not build the package it was asked for. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export interface ExportOptions {
  /** Entry names to export, in the order given. Ignored when `all` is set. */
  names?: string[]
  /** Export every managed entry (external ones are skipped, not exported). */
  all?: boolean
  /** Output path: `*.zip` builds an archive, anything else a directory tree. */
  out: string
  io?: OpsIO
}

export interface ExportResult {
  out: string
  format: 'zip' | 'directory'
  /** Entries written into the package. */
  entries: number
  /** Payload files written (the label is not counted). */
  files: number
  /** Entries left out on purpose; already recorded in the label. */
  skipped: PackageSkipped[]
}

const EXTERNAL_REASON =
  'external (link-only) — points at a directory on this machine, which nexus does not copy'

/**
 * Build a package from the manifest. Read-only with respect to nexus state:
 * nothing is registered, nothing is linked, and the only thing written is the
 * package itself.
 */
export async function exportSkills(options: ExportOptions): Promise<ExportResult> {
  const { names, all, out, io } = options
  if (all !== true && (names === undefined || names.length === 0)) {
    throw new ExportError('nothing to export: name one or more entries, or pass --all')
  }

  const manifest = await readManifest()
  const selected: SkillEntry[] = []
  const skipped: PackageSkipped[] = []

  if (all === true) {
    if (manifest.skills.length === 0) {
      throw new ExportError('the manifest holds no entries to export')
    }
    for (const entry of manifest.skills) {
      if (isExternalEntry(entry)) {
        skipped.push({ name: entry.name, reason: EXTERNAL_REASON })
        continue
      }
      selected.push(entry)
    }
  } else {
    for (const name of names!) {
      const entry = findEntry(manifest, name)
      if (entry === undefined) throw new ExportError(`no skill named "${name}"`)
      if (isExternalEntry(entry)) {
        throw new ExportError(
          `"${entry.name}" links a directory nexus does not own, so it cannot be exported — ` +
            `copy that directory yourself, or adopt it into repos/ first`,
        )
      }
      selected.push(entry)
    }
  }

  const files: ZipInputFile[] = []
  const entries: PackageEntry[] = []

  for (const entry of selected) {
    const clone = repoDir(entry.path)
    const skillRoot = entry.subdir === undefined ? clone : join(clone, entry.subdir)
    const prefix = `skills/${entry.name}`

    let payload: WalkedFile[]
    try {
      payload = await walk(skillRoot)
    } catch {
      // A missing directory is fatal for a named entry (the user asked for it
      // and silence would hide a broken clone) but merely recorded for --all.
      if (all !== true) throw new ExportError(`"${entry.name}" has no directory at ${skillRoot}`)
      skipped.push({ name: entry.name, reason: 'directory missing' })
      continue
    }

    io?.progress('exporting', entry.name)

    const parsed = await previewSkills(skillRoot)
    const links = await entryLinks(entry)

    const skills: PackageSkill[] = parsed.map((s) => {
      const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name
      const rel = relative(skillRoot, s.resourceBase)
      const target = resolve(s.resourceBase)
      return {
        root: rel === '' ? prefix : `${prefix}/${toPosix(rel)}`,
        name: fmName || entry.name,
        description: s.description,
        // Attribution by resolved target, the same predicate `entryLinks` uses:
        // two skills of one collection never claim each other's links, and a
        // hand-made alias pointing at this skill is carried along verbatim.
        links: links.filter((l) => resolve(l.target) === target).map((l) => l.name),
      }
    })

    for (const file of payload) {
      files.push({ name: `${prefix}/${toPosix(file.rel)}`, data: await readFile(file.abs) })
    }

    entries.push({
      name: entry.name,
      url: entry.url,
      gitUrl: entry.gitUrl,
      ref: entry.ref,
      commit: entry.commit ?? '',
      ...(entry.subdir === undefined ? {} : { subdir: entry.subdir }),
      enabled: links.length > 0,
      skills,
    })
  }

  if (entries.length === 0) {
    const why = skipped.map((s) => `${s.name} (${s.reason})`).join('; ')
    throw new ExportError(`nothing to export${why === '' ? '' : `: ${why}`}`)
  }

  const label: NexusPackage = {
    schema: PACKAGE_SCHEMA,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    generator: await generatorName(),
    skipped,
    entries,
  }
  const labelJson = `${JSON.stringify(label, null, 2)}\n`
  const format: 'zip' | 'directory' = out.toLowerCase().endsWith('.zip') ? 'zip' : 'directory'

  if (format === 'zip') {
    await mkdir(dirname(resolve(out)), { recursive: true })
    const archive = createZip([
      ...files,
      { name: PACKAGE_MANIFEST, data: Buffer.from(labelJson, 'utf8') },
    ])
    await writeFile(out, archive)
  } else {
    await mkdir(out, { recursive: true })
    await writeFile(join(out, PACKAGE_MANIFEST), labelJson, 'utf8')
    for (const file of files) {
      const dest = join(out, ...file.name.split('/'))
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, file.data)
    }
  }

  return { out, format, entries: entries.length, files: files.length, skipped }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface WalkedFile {
  /** Absolute path on disk. */
  abs: string
  /** Path relative to the walked root, using the platform separator. */
  rel: string
}

/**
 * Every regular file below `dir`, skipping `.git` and never following a
 * symlink: a package must not depend on where a link happens to point on the
 * exporting machine.
 */
async function walk(dir: string, base: string = dir): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []
  const dirents = await readdir(dir, { withFileTypes: true })
  for (const dirent of dirents) {
    if (dirent.name === '.git') continue
    const abs = join(dir, dirent.name)
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory()) {
      out.push(...(await walk(abs, base)))
    } else if (dirent.isFile()) {
      out.push({ abs, rel: relative(base, abs) })
    }
  }
  return out
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}

/**
 * `name version` of the running nexus, read from the package manifest next to
 * `lib/` so a package can say which build produced it. Best-effort: a missing
 * or unparsable package.json must not fail an export.
 */
async function generatorName(): Promise<string> {
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown }
    if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
      return `${parsed.name} ${parsed.version}`
    }
  } catch {
    // fall through to the static name
  }
  return 'dsh-skills-nexus'
}

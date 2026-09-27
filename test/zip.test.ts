import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import type { OpsIO } from '../src/ops-io.js'

/**
 * Tests for ZIP installation (`src/zip.ts`, §9).
 *
 * The archives are built by hand (`buildZip`) for two reasons: the suite must
 * stay free of external tools (no `zip` binary on the CI matrix), and the
 * defenses in §9.1 are measured against *malformed* headers — declared sizes
 * that lie, oversized counts, odd external attributes — which no archiver
 * would produce on request.
 *
 * The CRC fields are written as zero: the reader deliberately does not verify
 * them (size and structure checks are what gate extraction), so computing
 * real CRCs here would test nothing.
 *
 * `paths.ts` reads DSH_HOME at import time, so the env var must be set before
 * the first import of the zip→manifest→paths chain (test/update.test.ts
 * pattern).
 */

/* ------------------------------------------------------------------ */
/* Minimal zip builder                                                 */
/* ------------------------------------------------------------------ */

interface ZipInput {
  name: string
  data?: string
  /** 0 = stored, 8 = deflate (default 0). Anything else is written as-is. */
  method?: number
  /** General-purpose flags (bit 0 = encrypted). */
  flags?: number
  /** Raw external attributes (symlink = 0xa1ff0000 here). */
  attrs?: number
  /** Override the sizes declared in the headers (bomb / integrity tests). */
  declaredUncompressed?: number
  declaredCompressed?: number
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

function buildZip(entries: ZipInput[], opts: { declaredCount?: number } = {}): Buffer {
  const chunks: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const data = Buffer.from(e.data ?? '', 'utf8')
    const comp = (e.method ?? 0) === 8 ? deflateRawSync(data) : data
    const name = Buffer.from(e.name, 'utf8')
    const uncompressedSize = e.declaredUncompressed ?? data.length
    const compressedSize = e.declaredCompressed ?? comp.length
    const flags = e.flags ?? 0
    const attrs = e.attrs ?? 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(e.method ?? 0, 8)
    local.writeUInt32LE(compressedSize, 18)
    local.writeUInt32LE(uncompressedSize, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(e.method ?? 0, 10)
    central.writeUInt32LE(compressedSize, 20)
    central.writeUInt32LE(uncompressedSize, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(attrs, 38)
    central.writeUInt32LE(offset, 42)

    chunks.push(local, name, comp)
    centrals.push(central, name)
    offset += 30 + name.length + comp.length
  }

  const localPart = Buffer.concat(chunks)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(opts.declaredCount ?? entries.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)
  return Buffer.concat([localPart, centralPart, eocd])
}

/** A minimal SKILL.md; omit the description to exercise normalization. */
function skillMd(name: string, description?: string): string {
  const desc = description === undefined ? '' : `description: ${description}\n`
  return `---\nname: ${name}\n${desc}---\n# ${name}\n`
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

let home: string
let zipmod: typeof import('../src/zip.js')
let manifest: typeof import('../src/manifest.js')
let paths: typeof import('../src/paths.js')
let link: typeof import('../src/link.js')

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'nexus-zip-'))
  process.env.DSH_HOME = home
  delete process.env.DSH_SKILLS_NEXUS_HOME
  zipmod = await import('../src/zip.js')
  manifest = await import('../src/manifest.js')
  paths = await import('../src/paths.js')
  link = await import('../src/link.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** Collecting OpsIO — no stdout/stderr, records how the core reported. */
interface TestIO extends OpsIO {
  emitted: string[]
  stages: string[]
}

function makeIO(): TestIO {
  const emitted: string[] = []
  const stages: string[] = []
  return {
    emitted,
    stages,
    confirm: async () => false,
    progress: (stage, detail) => {
      stages.push(detail ? `${stage}: ${detail}` : stage)
    },
    emit: (line) => {
      emitted.push(line)
    },
    interactive: false,
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/** Staging directories `.zip-stage-*` left under NEXUS_HOME. */
async function stageLeftovers(): Promise<string[]> {
  try {
    return (await readdir(paths.NEXUS_HOME)).filter((n) => n.startsWith('.zip-stage-'))
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ */
/* Happy paths                                                         */
/* ------------------------------------------------------------------ */

test('installs a single-skill archive, normalizes it, and registers source:zip', async () => {
  const io = makeIO()
  const zip = buildZip([
    { name: 'SKILL.md', data: skillMd('zip-skill'), method: 8 },
    { name: 'references/', data: '' },
    { name: 'references/notes.txt', data: 'hello' },
  ])

  const res = await zipmod.installFromZip(zip, { fileName: 'zip-skill.zip' }, io)

  // Entry name derived from the file name; the §5.3 field convention applies.
  assert.equal(res.entry.name, 'zip-skill')
  assert.equal(res.entry.source, 'zip')
  assert.equal(res.entry.ref, '')
  assert.equal(res.entry.gitUrl, '')
  assert.equal(res.entry.commit, '')
  assert.equal(res.entry.url, 'zip:zip-skill.zip')
  assert.equal(res.entry.path, 'zip-skill')

  // The missing description was filled in at install time (§9.2).
  assert.equal(res.normalized, 1)
  assert.equal(res.skills, 1)
  const written = await readFile(join(paths.repoDir('zip-skill'), 'SKILL.md'), 'utf8')
  assert.match(written, /description/)

  // Nested files come along; the single-skill entry links under its name.
  assert.equal(await exists(join(paths.repoDir('zip-skill'), 'references', 'notes.txt')), true)
  assert.deepEqual(res.links, ['zip-skill'])
  assert.equal(await link.isLinked('zip-skill'), true)

  const m = await manifest.readManifest()
  assert.equal(m.skills.find((s) => s.name === 'zip-skill')?.source, 'zip')
  assert.deepEqual(io.emitted, [], 'installFromZip reports through io only on demand')

  // Nothing git-like ever lands in repos/ for a zip install (§5.3).
  assert.equal(await exists(join(paths.repoDir('zip-skill'), '.git')), false)
  assert.deepEqual(await stageLeftovers(), [], 'no staging directory survives')
})

test('an explicit name wins over the derived file name', async () => {
  const zip = buildZip([{ name: 'SKILL.md', data: skillMd('inner-name') }])
  const res = await zipmod.installFromZip(zip, { name: 'outer-name', fileName: 'whatever.zip' }, makeIO())
  assert.equal(res.entry.name, 'outer-name')
  assert.equal(res.entry.url, 'zip:whatever.zip')
  assert.equal(await link.isLinked('outer-name'), true)
})

test('a multi-skill archive links each skill by its frontmatter name', async () => {
  const zip = buildZip([
    { name: 'skill-a.md', data: skillMd('skill-a', 'A') },
    { name: 'skill-b.md', data: skillMd('skill-b', 'B') },
  ])
  const res = await zipmod.installFromZip(zip, { name: 'bundle' }, makeIO())

  assert.equal(res.entry.name, 'bundle')
  assert.deepEqual([...res.links].sort(), ['skill-a', 'skill-b'])
  assert.equal(await link.isLinked('bundle'), false, 'multi-skill entries link per skill, not per entry')
  assert.equal(await link.isEntryEnabled(res.entry), true)
})

test('symlink, .git and directory entries are skipped with warnings', async () => {
  const zip = buildZip([
    { name: 'SKILL.md', data: skillMd('linky', 'd') },
    { name: 'evil-link', data: 'target', attrs: 0xa1ff0000 },
    { name: '.git/config', data: '[core]\n' },
    { name: 'empty-dir/', data: '' },
  ])
  const res = await zipmod.installFromZip(zip, { fileName: 'linky.zip' }, makeIO())

  assert.equal(res.entry.name, 'linky')
  assert.equal(res.warnings.length, 2)
  assert.match(res.warnings[0]!, /skipped symlink entry "evil-link"/)
  assert.match(res.warnings[1]!, /skipped \.git entry "\.git\/config"/)
  assert.equal(await exists(join(paths.repoDir('linky'), 'evil-link')), false)
  assert.equal(await exists(join(paths.repoDir('linky'), '.git')), false)
})

/* ------------------------------------------------------------------ */
/* §9.1 defenses — the archive is rejected before anything is written  */
/* ------------------------------------------------------------------ */

test('zip slip: an entry escaping the extraction directory rejects the archive', async () => {
  const zip = buildZip([{ name: '../evil.txt', data: 'x' }])
  await assert.rejects(
    zipmod.installFromZip(zip, { name: 'slip' }, makeIO()),
    /escapes the extraction directory/,
  )
  assert.deepEqual(await stageLeftovers(), [])
})

test('absolute entry names are rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: '/etc/passwd', data: 'x' }]), {}, makeIO()),
    /uses an absolute path/,
  )
})

test('a ":" path segment is rejected (drive letter / NTFS ADS)', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: 'c:/evil.txt', data: 'x' }]), {}, makeIO()),
    /contains a ":" segment/,
  )
})

test('a NUL byte in an entry name is rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: 'bad\0name', data: 'x' }]), {}, makeIO()),
    /NUL byte/,
  )
})

test('an entry with an empty name is rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: '', data: 'x' }]), {}, makeIO()),
    /empty name/,
  )
})

test('encrypted entries are rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: 'a.txt', data: 'x', flags: 0x1 }]), {}, makeIO()),
    /encrypted entries are not supported/,
  )
})

test('compression methods other than stored/deflate are rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: 'a.txt', data: 'x', method: 12 }]), {}, makeIO()),
    /unsupported compression method 12/,
  )
})

test('zip64 archives are rejected (EOCD sentinel)', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: 'a.txt', data: 'x' }], { declaredCount: 0xffff }), {}, makeIO()),
    /zip64 archives are not supported/,
  )
})

test('zip64 entry sizes are rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(
      buildZip([{ name: 'a.txt', data: 'x', method: 8, declaredUncompressed: 0xffffffff }]),
      {},
      makeIO(),
    ),
    /zip64 entries are not supported/,
  )
})

test('a stored entry with mismatched declared sizes is rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(
      buildZip([{ name: 'a.txt', data: 'abc', declaredCompressed: 5, declaredUncompressed: 3 }]),
      {},
      makeIO(),
    ),
    /mismatched sizes/,
  )
})

test('a file above the per-file uncompressed cap is rejected', async () => {
  const hundredMBPlusOne = 100 * 1024 * 1024 + 1
  await assert.rejects(
    zipmod.installFromZip(
      buildZip([{ name: 'a.txt', data: 'x', method: 8, declaredUncompressed: hundredMBPlusOne }]),
      {},
      makeIO(),
    ),
    /limit 104857600 per file/,
  )
})

test('an archive whose entries sum above the total cap is rejected', async () => {
  const ninetyMB = 90 * 1024 * 1024
  const entries = Array.from({ length: 6 }, (_, i) => ({
    name: `f${i}.txt`,
    data: 'x',
    method: 8,
    declaredUncompressed: ninetyMB,
  }))
  await assert.rejects(
    zipmod.installFromZip(buildZip(entries), {}, makeIO()),
    /unpacks to more than 524288000 bytes in total/,
  )
})

test('an archive declaring more than the entry cap is rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(
      buildZip([{ name: 'a.txt', data: 'x' }], { declaredCount: 5001 }),
      {},
      makeIO(),
    ),
    /the archive has 5001 entries \(limit 5000\)/,
  )
})

/* ------------------------------------------------------------------ */
/* Structural rejects                                                  */
/* ------------------------------------------------------------------ */

test('a buffer that is not a PKZip archive is rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(Buffer.from('hello world'), {}, makeIO()),
    /not a PKZip archive/,
  )
})

test('an empty archive is rejected', async () => {
  // A real-world empty zip is EOCD-only; the entry guard rejects it before
  // any staging directory is created (byte 0 is not a local header).
  await assert.rejects(
    zipmod.installFromZip(buildZip([]), {}, makeIO()),
    /not a PKZip archive/,
  )
  assert.deepEqual(await stageLeftovers(), [])

  // The parser's explicit empty check needs a local-header start whose EOCD
  // declares zero entries — a contradiction no archiver produces.
  const contradictory = Buffer.alloc(26)
  contradictory.writeUInt32LE(SIG_LOCAL, 0)
  contradictory.writeUInt32LE(SIG_EOCD, 4)
  await assert.rejects(
    zipmod.installFromZip(contradictory, {}, makeIO()),
    /the archive contains no entries/,
  )
  assert.deepEqual(await stageLeftovers(), [])
})

test('an archive with its EOCD cut off is rejected', async () => {
  const zip = buildZip([{ name: 'SKILL.md', data: skillMd('x', 'd') }])
  await assert.rejects(
    zipmod.installFromZip(zip.subarray(0, zip.length - 30), {}, makeIO()),
    /end of central directory not found/,
  )
})

test('an archive without installable SKILL.md content is rejected', async () => {
  await assert.rejects(
    zipmod.installFromZip(buildZip([{ name: 'README.md', data: 'hi' }]), { name: 'readme' }, makeIO()),
    /no installable SKILL.md content/,
  )
  assert.deepEqual(await stageLeftovers(), [])
})

/* ------------------------------------------------------------------ */
/* Registration guards                                                 */
/* ------------------------------------------------------------------ */

test('re-installing over a registered name is rejected and cleans up staging', async () => {
  const zip = buildZip([{ name: 'SKILL.md', data: skillMd('zip-skill', 'again') }])
  await assert.rejects(
    zipmod.installFromZip(zip, { name: 'zip-skill' }, makeIO()),
    /a skill named "zip-skill" is already registered/,
  )
  assert.deepEqual(await stageLeftovers(), [])
})

test('a name colliding with a manually placed entry is rejected', async () => {
  await mkdir(join(paths.OFFICIAL_SKILLS_DIR, 'manual-dir'), { recursive: true })
  const zip = buildZip([{ name: 'SKILL.md', data: skillMd('manual-dir', 'd') }])
  await assert.rejects(
    zipmod.installFromZip(zip, { name: 'manual-dir' }, makeIO()),
    /already exists in the official skills root/,
  )
  assert.deepEqual(await stageLeftovers(), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { createZip, readZip } from '../src/zip.js'
import type { ZipInputFile } from '../src/zip.js'

/**
 * Tests for the PKZip codec (`src/zip.ts`) — the package side of the source &
 * migration design (§5/§9.1).
 *
 * `zip.ts` used to be an installer; since zip stopped being an installation
 * method (§8 phase 3) it is the codec `export` writes with and `import` reads
 * with, and `readZip` is the only door into it. That door takes **foreign
 * input** — a package somebody else produced — so the §9.1 rejection matrix is
 * exactly as load-bearing as it was for installation, and it is measured here
 * through `readZip`: zip slip, absolute / `:` / NUL / empty names, encrypted
 * entries, unknown compression methods, zip64 in either form, the three size
 * caps and the structural rejects.
 *
 * The archives are built by hand (`buildZip`) for two reasons: the suite must
 * stay free of external tools (no `zip` binary on the CI matrix), and the
 * defenses are measured against *malformed* headers — declared sizes that lie,
 * oversized counts, odd external attributes — which no archiver would produce
 * on request.
 *
 * The CRC fields are written as zero: the reader deliberately does not verify
 * them (size and structure checks are what gate an entry), so computing real
 * CRCs here would test nothing. Nothing in this file needs a `DSH_HOME`: the
 * codec touches no filesystem.
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

/** Hand-built archive → the `{ name, data }` pairs `readZip` is expected to see. */
function namesOf(zip: Buffer): string[] {
  return readZip(zip).map((f) => f.name)
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

test('readZip returns the archive files, deflated entries included', () => {
  const zip = buildZip([
    { name: 'nexus-package.json', data: '{"schema":"x"}' },
    { name: 'skills/alpha/SKILL.md', data: '# alpha\n', method: 8 },
    { name: 'skills/alpha/references/notes.txt', data: 'hello' },
  ])

  const files = readZip(zip)
  assert.deepEqual(files.map((f) => f.name), [
    'nexus-package.json',
    'skills/alpha/SKILL.md',
    'skills/alpha/references/notes.txt',
  ])
  assert.equal(files[1]!.data.toString('utf8'), '# alpha\n', 'a deflate entry is inflated')
  assert.equal(files[2]!.data.toString('utf8'), 'hello')
})

test('a package round-trips through createZip and readZip', () => {
  // The writer is the export side and the reader the import side; the pair has
  // to agree on the subset both implement (stored entries, UTF-8 names).
  const input: ZipInputFile[] = [
    { name: 'nexus-package.json', data: Buffer.from('{"a":1}\n', 'utf8') },
    { name: 'skills/中文 名称/SKILL.md', data: Buffer.from('# 标题\n', 'utf8') },
  ]
  const back = readZip(createZip(input))
  assert.deepEqual(back.map((f) => [f.name, f.data.toString('utf8')]), [
    ['nexus-package.json', '{"a":1}\n'],
    ['skills/中文 名称/SKILL.md', '# 标题\n'],
  ])
})

test('readZip drops symlink, .git and directory entries', () => {
  // A package must carry neither links nor git state (§5), and a directory
  // entry carries no data — none of them may reach the importer's file map.
  const zip = buildZip([
    { name: 'SKILL.md', data: '# skill\n' },
    { name: 'evil-link', data: 'target', attrs: 0xa1ff0000 },
    { name: '.git/config', data: '[core]\n' },
    { name: 'nested/.git/HEAD', data: 'ref: refs/heads/main\n' },
    { name: 'empty-dir/', data: '' },
  ])

  assert.deepEqual(namesOf(zip), ['SKILL.md'])
})

/* ------------------------------------------------------------------ */
/* §9.1 defenses — the archive is rejected before anything is handed out */
/* ------------------------------------------------------------------ */

test('zip slip: an entry escaping the extraction base rejects the archive', () => {
  assert.throws(
    () => readZip(buildZip([{ name: '../evil.txt', data: 'x' }])),
    /escapes the extraction directory/,
  )
})

test('absolute entry names are rejected', () => {
  assert.throws(() => readZip(buildZip([{ name: '/etc/passwd', data: 'x' }])), /uses an absolute path/)
})

test('a ":" path segment is rejected (drive letter / NTFS ADS)', () => {
  assert.throws(() => readZip(buildZip([{ name: 'c:/evil.txt', data: 'x' }])), /contains a ":" segment/)
})

test('a NUL byte in an entry name is rejected', () => {
  assert.throws(() => readZip(buildZip([{ name: 'bad\0name', data: 'x' }])), /NUL byte/)
})

test('an entry with an empty name is rejected', () => {
  assert.throws(() => readZip(buildZip([{ name: '', data: 'x' }])), /empty name/)
})

test('encrypted entries are rejected', () => {
  assert.throws(
    () => readZip(buildZip([{ name: 'a.txt', data: 'x', flags: 0x1 }])),
    /encrypted entries are not supported/,
  )
})

test('compression methods other than stored/deflate are rejected', () => {
  assert.throws(
    () => readZip(buildZip([{ name: 'a.txt', data: 'x', method: 12 }])),
    /unsupported compression method 12/,
  )
})

test('zip64 archives are rejected (EOCD sentinel)', () => {
  assert.throws(
    () => readZip(buildZip([{ name: 'a.txt', data: 'x' }], { declaredCount: 0xffff })),
    /zip64 archives are not supported/,
  )
})

test('zip64 entry sizes are rejected', () => {
  assert.throws(
    () =>
      readZip(
        buildZip([{ name: 'a.txt', data: 'x', method: 8, declaredUncompressed: 0xffffffff }]),
      ),
    /zip64 entries are not supported/,
  )
})

test('a stored entry with mismatched declared sizes is rejected', () => {
  assert.throws(
    () =>
      readZip(
        buildZip([{ name: 'a.txt', data: 'abc', declaredCompressed: 5, declaredUncompressed: 3 }]),
      ),
    /mismatched sizes/,
  )
})

test('a file above the per-file uncompressed cap is rejected', () => {
  const hundredMBPlusOne = 100 * 1024 * 1024 + 1
  assert.throws(
    () =>
      readZip(
        buildZip([{ name: 'a.txt', data: 'x', method: 8, declaredUncompressed: hundredMBPlusOne }]),
      ),
    /limit 104857600 per file/,
  )
})

test('an archive whose entries sum above the total cap is rejected', () => {
  const ninetyMB = 90 * 1024 * 1024
  const entries = Array.from({ length: 6 }, (_, i) => ({
    name: `f${i}.txt`,
    data: 'x',
    method: 8,
    declaredUncompressed: ninetyMB,
  }))
  assert.throws(
    () => readZip(buildZip(entries)),
    /unpacks to more than 524288000 bytes in total/,
  )
})

test('an archive declaring more than the entry cap is rejected', () => {
  assert.throws(
    () => readZip(buildZip([{ name: 'a.txt', data: 'x' }], { declaredCount: 5001 })),
    /the archive has 5001 entries \(limit 5000\)/,
  )
})

/* ------------------------------------------------------------------ */
/* Structural rejects                                                  */
/* ------------------------------------------------------------------ */

test('a buffer that is not a PKZip archive is rejected', () => {
  assert.throws(() => readZip(Buffer.from('hello world')), /end of central directory not found/)
})

test('an archive with no entries is rejected', () => {
  // A real-world empty zip is EOCD-only.
  assert.throws(() => readZip(buildZip([])), /the archive contains no entries/)

  // …and so is the contradictory shape a lying header produces: a local file
  // header (so a caller's "PKZip?" sniff passes) whose EOCD declares zero
  // entries. No archiver emits it, which is exactly why it is pinned.
  const contradictory = Buffer.alloc(26)
  contradictory.writeUInt32LE(SIG_LOCAL, 0)
  contradictory.writeUInt32LE(SIG_EOCD, 4)
  assert.throws(() => readZip(contradictory), /the archive contains no entries/)
})

test('an archive with its EOCD cut off is rejected', () => {
  const zip = buildZip([{ name: 'SKILL.md', data: '# x\n' }])
  assert.throws(() => readZip(zip.subarray(0, zip.length - 30)), /end of central directory not found/)
})

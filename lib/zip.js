import { resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
/**
 * The PKZip codec — a hand-written minimal reader/writer pair. Runtime
 * dependency count stays at zero: only `node:zlib` (inflateRaw) is used for
 * the deflate method.
 *
 * Since zip stopped being an installation method (see
 * `docs/sources-and-packages.md`), this module is the
 * *package* codec: `createZip` writes what `export` produces, `readZip` reads
 * what `import` consumes. A package is read as whole files into memory — this
 * layer never unpacks onto disk — and the install orchestration that used to
 * live here (`installFromZip`, with the `add-zip` route and the `source` field)
 * is gone.
 *
 * Threat model and defenses, enforced before a single byte is handed
 * back — an imported package is *foreign input*:
 *   - zip slip (`..` / absolute entry names) — every entry must resolve inside
 *     the extraction base or the whole archive is rejected;
 *   - symlink entries — skipped entirely (never handed back);
 *   - `.git` entries — skipped (a package never carries git state);
 *   - decompression bombs — 500MB total, 100MB per file, 5000 entries, and
 *     `inflateRaw` output bounded per file as a second line of defense;
 *   - encryption — any encrypted entry rejects the archive; only the stored
 *     (0) and deflate (8) methods are accepted; zip64 is rejected.
 */
/** Extracted-size caps (§9.1). */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_FILE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** Entry-count cap (§9.1). */
const MAX_ENTRIES = 5000;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** An archive failed validation (§9.1) — malformed, unsafe or over a cap. */
export class ZipError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ZipError';
    }
}
/** Locate the end-of-central-directory record (scans back over the comment). */
function findEocd(buf) {
    const minEocd = 22;
    if (buf.length < minEocd)
        return -1;
    const lowest = Math.max(0, buf.length - (0xffff + minEocd));
    for (let i = buf.length - minEocd; i >= lowest; i--) {
        if (buf.readUInt32LE(i) === SIG_EOCD)
            return i;
    }
    return -1;
}
/**
 * Normalize and validate one raw entry name; throws {@link ZipError} on any
 * name that must reject the whole archive. Returns the path to expose.
 *
 * Names coming from a zip may use `\` separators (Windows-made archives), so
 * they are unified before resolution. Entry names are decoded as UTF-8 (the
 * `EFS` flag is not required — a mis-decoded name fails the safety checks
 * below or simply produces an odd file name; it can never escape).
 */
function validateEntryName(raw, base) {
    if (raw.length === 0)
        throw new ZipError('the archive contains an entry with an empty name');
    if (raw.includes('\0'))
        throw new ZipError('an entry name contains a NUL byte');
    if (raw.startsWith('/') || raw.startsWith('\\')) {
        throw new ZipError(`entry "${raw}" uses an absolute path`);
    }
    const name = raw
        .replaceAll('\\', '/')
        .split('/')
        .filter((segment) => segment !== '' && segment !== '.')
        .join('/');
    if (name.length === 0)
        throw new ZipError(`entry "${raw}" has an empty name after normalization`);
    // A colon inside a segment means a drive letter or an NTFS alternate data
    // stream on Windows — never valid in an extracted tree.
    if (name.split('/').some((segment) => segment.includes(':'))) {
        throw new ZipError(`entry "${raw}" contains a ":" segment (unsafe on Windows)`);
    }
    const full = resolve(base, name);
    if (full !== resolve(base) && !full.startsWith(resolve(base) + sep)) {
        throw new ZipError(`entry "${raw}" escapes the extraction directory`);
    }
    return name;
}
/** True when any path segment of `name` is `.git` (exact match). */
function hasGitSegment(name) {
    return name.split('/').includes('.git');
}
/**
 * Parse and validate the archive against every static rule of §9.1.
 *
 * All checks run before a single entry is handed back, so a malicious archive
 * is rejected while nothing has been produced. Skipped entries (symlinks,
 * `.git`) are dropped rather than rejected — a package must carry neither, and
 * `readZip`'s caller only ever receives the file list it may use.
 */
function parseAndValidate(buf, base) {
    const eocd = findEocd(buf);
    if (eocd < 0)
        throw new ZipError('end of central directory not found — not a valid zip archive');
    const totalEntries = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        throw new ZipError('zip64 archives are not supported');
    }
    if (totalEntries === 0)
        throw new ZipError('the archive contains no entries');
    if (totalEntries > MAX_ENTRIES) {
        throw new ZipError(`the archive has ${totalEntries} entries (limit ${MAX_ENTRIES})`);
    }
    if (cdOffset + cdSize > buf.length || cdOffset + cdSize > eocd) {
        throw new ZipError('the central directory is out of bounds');
    }
    const entries = [];
    let totalUncompressed = 0;
    let off = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (off + 46 > buf.length || buf.readUInt32LE(off) !== SIG_CENTRAL) {
            throw new ZipError('the central directory is truncated or malformed');
        }
        const flags = buf.readUInt16LE(off + 8);
        const method = buf.readUInt16LE(off + 10);
        const compressedSize = buf.readUInt32LE(off + 20);
        const uncompressedSize = buf.readUInt32LE(off + 24);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const externalAttrs = buf.readUInt32LE(off + 38);
        const localOffset = buf.readUInt32LE(off + 42);
        const nameEnd = off + 46 + nameLen;
        if (nameEnd > buf.length)
            throw new ZipError('the central directory is truncated');
        if (flags & 0x1)
            throw new ZipError('encrypted entries are not supported');
        if (method !== 0 && method !== 8) {
            throw new ZipError(`unsupported compression method ${method} (only stored / deflate)`);
        }
        if (compressedSize === 0xffffffff ||
            uncompressedSize === 0xffffffff ||
            localOffset === 0xffffffff) {
            throw new ZipError('zip64 entries are not supported');
        }
        if (method === 0 && compressedSize !== uncompressedSize) {
            throw new ZipError('a stored entry declares mismatched sizes');
        }
        const raw = buf.subarray(off + 46, nameEnd).toString('utf8');
        const name = validateEntryName(raw, base);
        off = nameEnd + extraLen + commentLen;
        // Symlinks — never handed back (§9.1): a link could point anywhere on the
        // host once something writes it out.
        if ((externalAttrs >>> 16 & 0xf000) === 0xa000)
            continue;
        // git state — a package must not carry a repository (§5).
        if (hasGitSegment(name))
            continue;
        // Directory entries: a package is read as files, and a directory carries no
        // data (its name was still validated above).
        if (raw.endsWith('/'))
            continue;
        if (uncompressedSize > MAX_FILE_UNCOMPRESSED_BYTES) {
            throw new ZipError(`entry "${raw}" unpacks to ${uncompressedSize} bytes ` +
                `(limit ${MAX_FILE_UNCOMPRESSED_BYTES} per file)`);
        }
        totalUncompressed += uncompressedSize;
        if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
            throw new ZipError(`the archive unpacks to more than ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes in total`);
        }
        entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    }
    if (off > cdOffset + cdSize)
        throw new ZipError('the central directory is truncated');
    return entries;
}
/** Read and (for deflate) inflate one entry's data, strictly bounded. */
function readEntryData(buf, entry) {
    const off = entry.localOffset;
    if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) {
        throw new ZipError(`entry "${entry.name}" has no local file header`);
    }
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buf.length)
        throw new ZipError(`entry "${entry.name}" data is truncated`);
    const raw = buf.subarray(dataStart, dataEnd);
    let data;
    if (entry.method === 0) {
        data = raw;
    }
    else {
        try {
            // maxOutputLength is the second line of defense against a lying or
            // bomb-shaped uncompressed size (§9.1).
            data = inflateRawSync(raw, { maxOutputLength: MAX_FILE_UNCOMPRESSED_BYTES + 1 });
        }
        catch {
            throw new ZipError(`entry "${entry.name}" could not be decompressed`);
        }
    }
    if (data.length !== entry.uncompressedSize) {
        throw new ZipError(`entry "${entry.name}" does not match its declared size`);
    }
    return data;
}
/**
 * The export side of the PKZip format: `readZip` reads packages, this writes
 * them. Entries are **stored** (method 0), never deflated — a package is
 * a transport container that any unzip implementation must be able to read
 * without nexus shipping a compressor, and the payload is Markdown.
 *
 * The output is the same subset the reader above accepts: local headers, one
 * central directory, one EOCD, no extra fields, no comment. Names are UTF-8
 * with the language-encoding flag set, so non-ASCII paths survive a round trip.
 */
export function createZip(files) {
    if (files.length > MAX_ENTRIES) {
        throw new ZipError(`too many files for one archive (${files.length} > ${MAX_ENTRIES})`);
    }
    const { date, time } = dosDateTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
        assertWritableName(file.name);
        const name = Buffer.from(file.name, 'utf8');
        if (file.data.length > MAX_FILE_UNCOMPRESSED_BYTES) {
            throw new ZipError(`file too large to package: "${file.name}"`);
        }
        const crc = crc32(file.data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(SIG_LOCAL, 0);
        local.writeUInt16LE(20, 4); // version needed: 2.0
        local.writeUInt16LE(0x0800, 6); // names are UTF-8
        local.writeUInt16LE(0, 8); // stored
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(file.data.length, 18);
        local.writeUInt32LE(file.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28); // extra field length
        parts.push(local, name, file.data);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(SIG_CENTRAL, 0);
        entry.writeUInt16LE(20, 4); // version made by
        entry.writeUInt16LE(20, 6); // version needed
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(0, 10);
        entry.writeUInt16LE(time, 12);
        entry.writeUInt16LE(date, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(file.data.length, 20);
        entry.writeUInt32LE(file.data.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt16LE(0, 30); // extra
        entry.writeUInt16LE(0, 32); // comment
        entry.writeUInt16LE(0, 34); // disk number
        entry.writeUInt16LE(0, 36); // internal attributes
        entry.writeUInt32LE(0, 38); // external attributes
        entry.writeUInt32LE(offset, 42);
        central.push(entry, name);
        offset += local.length + name.length + file.data.length;
    }
    const directory = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4); // this disk
    eocd.writeUInt16LE(0, 6); // disk with the central directory
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(directory.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20); // comment length
    return Buffer.concat([...parts, directory, eocd]);
}
/** Reject archive paths the reader would refuse (or that escape the root). */
function assertWritableName(raw) {
    if (raw.length === 0)
        throw new ZipError('refusing to write an entry with an empty name');
    if (raw.includes('\0'))
        throw new ZipError('refusing to write an entry name with a NUL byte');
    // A drive letter only makes a path absolute when a separator follows it;
    // `a:b` is an NTFS-style alternate data stream and is reported as such below.
    if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
        throw new ZipError(`entry "${raw}" uses an absolute path`);
    }
    if (raw.includes('\\')) {
        throw new ZipError(`entry "${raw}" uses a backslash separator`);
    }
    if (raw.length > 0xffff)
        throw new ZipError(`entry name is too long for PKZip: "${raw}"`);
    for (const part of raw.split('/')) {
        if (part.length === 0)
            throw new ZipError(`entry "${raw}" has an empty path segment`);
        if (part === '.' || part === '..') {
            throw new ZipError(`entry "${raw}" escapes the archive root`);
        }
        if (part.includes(':')) {
            throw new ZipError(`entry "${raw}" contains a ":" segment (unsafe on Windows)`);
        }
    }
}
/** Local-time MS-DOS date/time pair, the only timestamp PKZip stores. */
function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date, time };
}
let crcTable;
/** CRC-32 (IEEE 802.3) — PKZip's per-entry checksum. */
function crc32(buf) {
    if (crcTable === undefined) {
        crcTable = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++)
                c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[i] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const byte of buf)
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
/**
 * Read an archive into memory — the package side of the codec, paired with
 * {@link createZip} and used by `import` (a package is read as whole files, not
 * unpacked onto disk) and by the export round-trip test.
 *
 * Every static rule of §9.1 still applies: absolute paths, `..` escapes, `:`
 * segments, encrypted and zip64 entries, and the count/size caps are all
 * rejected up front. Symlink and `.git` entries are dropped: a package never
 * carries either, and the caller is handed only the files it may use.
 */
export function readZip(buf) {
    return parseAndValidate(buf, '').map((entry) => ({
        name: entry.name,
        data: readEntryData(buf, entry),
    }));
}
//# sourceMappingURL=zip.js.map
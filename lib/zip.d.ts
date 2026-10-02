/** An archive failed validation (§9.1) — malformed, unsafe or over a cap. */
export declare class ZipError extends Error {
    constructor(message: string);
}
/** One file to place in an archive built by {@link createZip}. */
export interface ZipInputFile {
    /** Archive path with `/` separators; relative, no `..`, no leading `/`. */
    name: string;
    data: Buffer;
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
export declare function createZip(files: ZipInputFile[]): Buffer;
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
export declare function readZip(buf: Buffer): ZipInputFile[];
//# sourceMappingURL=zip.d.ts.map
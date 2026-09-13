/** `list` — show registered skills and their status. */
export declare function list(_argv: string[]): Promise<number>;
/**
 * Derive a canonical `owner/repo` source label from a normalized git URL, so
 * entries added via different spec forms (`github:o/r`, `https://…/o/r.git`,
 * `o/r`) all group under the same string in `list`. Takes the last two
 * `/`- or `:`-delimited segments after stripping a trailing `.git`.
 *
 * Exported for unit testing — the derivation is pure (no FS, no I/O).
 */
export declare function sourceLabel(gitUrl: string): string;
//# sourceMappingURL=list.d.ts.map
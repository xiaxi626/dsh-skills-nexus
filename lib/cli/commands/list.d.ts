import type { OpsIO } from '../../ops-io.js';
/**
 * `list [--names | --json]` — show registered skills and their status.
 *
 * `--names` is the machine path: skill names only, one per line, in manifest
 * order, with no header, padding or footer. Shell completions shell out to it
 * for the installed names instead of parsing `manifest.json`, so the CLI stays
 * the only interface to nexus state and an internal schema change cannot
 * silently break them — the same reason git completion calls `for-each-ref`
 * rather than reading `.git/refs/`. An empty manifest prints nothing on this
 * path (the human "No skills registered." hint is noise on a stream that
 * scripts split on newlines); exit stays 0.
 *
 * `--json` (P0 §4.1) is the structured sibling of `--names`: the same data the
 * panel's `GET /list` serves, from the same `listEntries()` core, so the two
 * faces cannot disagree about what is installed. The two flags are mutually
 * exclusive (see parseListArgs).
 *
 * Exit codes: 0 = listed, 1 = manifest unreadable, 2 = usage error.
 */
export declare function list(argv: string[], io?: OpsIO): Promise<number>;
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
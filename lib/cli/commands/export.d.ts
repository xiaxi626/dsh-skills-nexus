import type { OpsIO } from '../../ops-io.js';
/**
 * `export <name>... | --all [--out <file>]` — package skills so another machine
 * can re-create them (channel C of the source & migration design, §4.1/§10.1).
 *
 * Thin wrapper over `src/export.ts`: it parses argv, derives the default output
 * name, and turns the core's result into the two lines the user needs — where
 * the package went, and what was deliberately left out of it. Everything about
 * *what* a package contains lives in the core, so the plugin half can reuse it
 * without a second implementation.
 *
 * Default output: `<name>.zip` for a single named entry, `nexus-export.zip` for
 * several, `nexus-export-<YYYYMMDD>.zip` for `--all`. The extension chooses the
 * format — `.zip` is an archive, anything else a directory tree.
 *
 * Exit codes: 0 = package written, 1 = export failed, 2 = usage error.
 */
export declare function exportCommand(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=export.d.ts.map
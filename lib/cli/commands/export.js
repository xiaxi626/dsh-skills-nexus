import { cliIO } from '../../ops-io.js';
import { parseExportArgs } from '../args.js';
import { ExportError, exportSkills } from '../../export.js';
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
export async function exportCommand(argv, io = cliIO) {
    let options;
    try {
        options = parseExportArgs(argv);
    }
    catch (err) {
        io.error(`${err instanceof Error ? err.message : String(err)}`);
        return 2;
    }
    const out = options.out ?? defaultOut(options);
    try {
        const result = await exportSkills({ names: options.names, all: options.all, out, io });
        io.emit(`  ✓ ${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}, ` +
            `${result.files} file${result.files === 1 ? '' : 's'} → ${result.out} (${result.format})\n`);
        for (const skipped of result.skipped) {
            io.emit(`  ⚠ skipped "${skipped.name}": ${skipped.reason}\n`);
        }
        return 0;
    }
    catch (err) {
        if (err instanceof ExportError) {
            io.error(err.message);
            return 1;
        }
        io.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}
function defaultOut(options) {
    if (options.all)
        return `nexus-export-${stamp()}.zip`;
    if (options.names.length === 1)
        return `${options.names[0]}.zip`;
    return 'nexus-export.zip';
}
/** `YYYYMMDD` in local time — a package name that sorts by age. */
function stamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}
//# sourceMappingURL=export.js.map
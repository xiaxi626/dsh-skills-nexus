import { cliIO } from '../../ops-io.js';
import { parseLinkArgs } from '../args.js';
import { planLinkLocal, linkLocal } from '../../external.js';
/**
 * `link <source>` — register external skills as manifest entries and create
 * symlinks in the official DSH skills root.
 *
 * Currently only `trae-cn` is accepted as a source. The command discovers
 * skills under `~/.trae-cn/skills/` and `~/.trae-cn/builtin_skills/`, creates
 * manifest entries with `ownership: 'external'`, and symlinks each skill into
 * `~/.dsh/skills/` under a flat name derived from its group path.
 *
 * Semantics mirror `import`: source is required, `--dry-run` previews, without
 * it the command executes. `--json` emits a structured report.
 *
 * Exit codes: 0 = done, 1 = error, 2 = usage error.
 */
export async function link(argv, io = cliIO) {
    let opts;
    try {
        opts = parseLinkArgs(argv);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        io.error(`error: ${message}\n`);
        return 2;
    }
    const linkOpts = {
        ...(opts.traeCnDir !== undefined ? { traeCnDir: opts.traeCnDir } : {}),
        ...(opts.group !== undefined ? { group: opts.group } : {}),
        ...(opts.force ? { force: true } : {}),
    };
    if (opts.dryRun) {
        // Preview mode: plan only, print what would happen.
        let plan;
        try {
            plan = await planLinkLocal(opts.source, linkOpts);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            io.error(`error: ${message}\n`);
            return 1;
        }
        if (opts.json) {
            io.emit(JSON.stringify({ version: 1, plan }, null, 2) + '\n');
            return 0;
        }
        if (plan.entries.length === 0 && plan.conflicts.length === 0) {
            io.emit(`No skills found under the trae-cn root.\n`);
            return 0;
        }
        if (plan.conflicts.length > 0) {
            io.emit(`The following entries already exist (pass --force to overwrite):\n`);
            for (const name of plan.conflicts) {
                io.emit(`  - ${name}\n`);
            }
        }
        if (plan.entries.length > 0) {
            io.emit(`Would create ${plan.entries.length} entry/entries:\n`);
            for (const entry of plan.entries) {
                const group = entry.groupPath.join('/');
                io.emit(`  ${entry.name}  (${group})  →  ${entry.externalDir}\n`);
            }
        }
        return 0;
    }
    // Execute mode: plan + create entries + symlinks.
    let result;
    try {
        result = await linkLocal(opts.source, linkOpts, io);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        io.error(`error: ${message}\n`);
        return 1;
    }
    if (opts.json) {
        io.emit(JSON.stringify({ version: 1, ...result }, null, 2) + '\n');
        return 0;
    }
    const { plan, result: res } = result;
    if (res.added.length > 0) {
        io.emit(`Linked ${res.added.length} skill(s) from ${opts.source}:\n`);
        for (const name of res.added) {
            const entry = plan.entries.find((e) => e.name === name);
            const group = entry ? entry.groupPath.join('/') : name;
            io.emit(`  ${name}  (${group})\n`);
        }
    }
    if (res.skipped.length > 0) {
        io.emit(`Skipped ${res.skipped.length} entry/entries (already exist):\n`);
        for (const name of res.skipped) {
            io.emit(`  - ${name}\n`);
        }
    }
    if (res.added.length === 0 && res.skipped.length === 0) {
        io.emit(`No skills found under the trae-cn root.\n`);
    }
    return 0;
}
//# sourceMappingURL=link.js.map
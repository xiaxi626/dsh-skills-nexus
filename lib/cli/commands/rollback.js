import { cliIO } from '../../ops-io.js';
import { withSkillFileLock } from '../../locks.js';
import { findEntry, readManifest } from '../../manifest.js';
import { readRollbackPoint, rollbackEntry, ROLLBACK_CONSUMED_MESSAGE } from '../../rollback.js';
import { emitJson, fatalJsonError, jsonIO } from '../json-io.js';
export function parseRollbackArgs(argv) {
    const names = [];
    let json = false;
    for (const arg of argv) {
        if (arg === '--json')
            json = true;
        else if (arg.startsWith('-'))
            throw new Error(`Unknown rollback option: ${arg}`);
        else
            names.push(arg);
    }
    if (names.length !== 1 || !names[0])
        throw new Error('usage: dsh-skills-nexus rollback <name> [--json]');
    return { name: names[0], json };
}
export async function rollback(argv, io = cliIO) {
    let options;
    try {
        options = parseRollbackArgs(argv);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (argv.some((a) => a === '--json' || a.startsWith('--json=')))
            fatalJsonError(io, message);
        else
            io.error(message);
        return 2;
    }
    const { name, json } = options;
    const out = json ? jsonIO(io) : io;
    let result = { name, status: 'failed', fromCommit: null, toCommit: null, fromRef: null, toRef: null };
    try {
        await withSkillFileLock(name, async () => {
            const entry = findEntry(await readManifest(), name);
            const point = entry ? await readRollbackPoint(entry) : undefined;
            if (point) {
                result = { ...result, fromCommit: point.to.commit, toCommit: point.from.commit, fromRef: point.to.ref, toRef: point.from.ref };
            }
            result = { ...await rollbackEntry(name, out), message: ROLLBACK_CONSUMED_MESSAGE };
        });
        out.emit(`  ✓ ${result.fromCommit?.slice(0, 7)} → ${result.toCommit?.slice(0, 7)}\n${ROLLBACK_CONSUMED_MESSAGE}\n`);
    }
    catch (err) {
        result = { ...result, status: 'failed', error: err instanceof Error ? err.message : String(err) };
        out.error(result.error);
    }
    if (json)
        emitJson(io, { version: 1, results: [result] });
    return result.status === 'rolled-back' ? 0 : 1;
}
//# sourceMappingURL=rollback.js.map
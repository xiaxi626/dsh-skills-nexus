import { readManifest } from '../../manifest.js';
import { repoDir } from '../../paths.js';
import { getHeadCommit } from '../../git.js';
import { isEntryEnabled } from '../../link.js';
import { updateEntry } from '../../update.js';
import { cliIO } from '../../ops-io.js';
import { acquireSkillFileLock } from '../../locks.js';
import { parseUpdateArgs } from '../args.js';
import { batchPrefix } from '../progress.js';
import { emitJson, fatalJsonError, jsonIO } from '../json-io.js';
/**
 * `update [name] [--json]` — bring a skill's clone to the latest state, or
 * verify a pinned one. Re-normalizes frontmatter and re-creates symlinks after
 * pull.
 *
 * Dispatch is decided by how the clone was pinned at `add` time:
 *   - branch pin (symbolic HEAD) → `git pull --ff-only`
 *   - tag / commit pin (detached) → verify pin, restore if drifted
 *
 * After update, frontmatter is re-normalized (git pull may have overwritten
 * previous fixes) and symlinks are re-created.
 *
 * A dirty worktree would block `git pull --ff-only` and pin restoration —
 * and install-time normalization rewrites `SKILL.md` in place, so managed
 * clones are usually dirty. Local changes are therefore discarded (with a
 * warning) before pulling / restoring; normalization is re-applied after.
 *
 * `--json` (P0 §4.3) reports one result per entry with its before/after commit.
 * Every entry is attempted independently, so a failure on one does not stop the
 * rest and the exit code is non-zero if any failed.
 */
export async function update(argv, io = cliIO) {
    let target;
    let json;
    try {
        const opts = parseUpdateArgs(argv);
        target = opts.target;
        json = opts.json;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (jsonRequested(argv)) {
            fatalJsonError(io, message);
            return 2;
        }
        io.error(`error: ${message}`);
        return 2;
    }
    const manifest = await readManifest();
    // Update all enabled (linked) skills by default, or a specific target.
    const targets = target
        ? manifest.skills.filter((s) => s.name === target)
        : (await Promise.all(manifest.skills.map(async (s) => ({ s, linked: await isEntryEnabled(s) })))).filter(({ linked }) => linked).map(({ s }) => s);
    if (target && targets.length === 0) {
        const message = `No skill named "${target}".`;
        if (json) {
            fatalJsonError(io, message);
            return 1;
        }
        io.error(message);
        return 1;
    }
    if (targets.length === 0) {
        if (json) {
            emitJson(io, { version: 1, results: [], summary: { updated: 0, failed: 0 } });
            return 0;
        }
        io.emit('Nothing to update (no enabled skills).\n');
        return 0;
    }
    // Machine mode: the shared code's human lines go to a silent sink so stdout
    // stays pure JSON; diagnostics keep flowing to stderr.
    const out = json ? jsonIO(io) : io;
    let failures = 0;
    const results = [];
    const total = targets.length;
    for (let i = 0; i < targets.length; i++) {
        const s = targets[i];
        const dir = repoDir(s.path);
        out.emit(`${batchPrefix(i + 1, total)}Updating ${s.name} (${s.ref})…\n`);
        // §7.3 layer 3: cross-process exclusion against CLI/server collisions.
        // Acquire failure flows into the same per-item failure path as any other
        // error (message explains the lock), with release guaranteed by finally.
        let lock;
        let before = null;
        let after = null;
        let status = 'failed';
        try {
            lock = await acquireSkillFileLock(s.name);
            before = await getHeadCommit(dir);
            const result = await updateEntry(s.name, out);
            before = result.before;
            after = result.after;
            status = result.status;
        }
        catch (err) {
            failures++;
            const message = err instanceof Error ? err.message : String(err);
            out.error(`  ✗ failed: ${message}`);
            results.push({
                name: s.name,
                status: 'failed',
                ref: s.ref,
                fromCommit: before,
                toCommit: null,
                error: message,
            });
            continue;
        }
        finally {
            await lock?.release();
        }
        results.push({ name: s.name, status, ref: s.ref, fromCommit: before, toCommit: after });
    }
    if (json) {
        emitJson(io, {
            version: 1,
            results,
            summary: {
                updated: results.filter((r) => r.status === 'updated').length,
                failed: results.filter((r) => r.status === 'failed').length,
            },
        });
    }
    return failures === 0 ? 0 : 1;
}
/**
 * True when the argv the parser just rejected asked for the JSON contract, so
 * a usage error still answers in the machine dialect on stderr (P0 §4.6).
 */
function jsonRequested(argv) {
    return argv.some((a) => a === '--json' || a.startsWith('--json='));
}
//# sourceMappingURL=update.js.map
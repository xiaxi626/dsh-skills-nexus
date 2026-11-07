import { readManifest } from '../../manifest.js';
import { removeSkill } from '../../remove.js';
import { cliIO } from '../../ops-io.js';
import { withSkillFileLock, SkillLockedError } from '../../locks.js';
import { hasMeta, matchNames } from '../glob.js';
import { parseRemoveArgs } from '../args.js';
import { emitJson, fatalJsonError, jsonIO } from '../json-io.js';
import { removeProjectLink } from '../../project.js';
import { resolveProjectScope } from '../project-scope.js';
/**
 * `remove <name-or-pattern>...` — delete cloned dirs, remove symlinks, and
 * unregister one or more skills.
 *
 * Accepts exact names and `*`/`?` globs (matched against registered skill
 * names). Every token is resolved to a set of names, de-duplicated, then each
 * name is removed independently: a name that isn't registered is a per-item
 * failure that does not stop the rest, and the exit code is non-zero if any
 * item failed (the same model as `update`).
 *
 * Because a glob can expand to many skills and removal is destructive
 * (deletes the clone + symlinks), a pattern that matches more than one skill is
 * guarded: the full deletion set is shown and confirmation is required unless
 * `--yes` is given. On a non-TTY (scripts) the guard cannot prompt, so it
 * refuses with exit code 2 rather than silently deleting everything matched.
 * Exact single names are unaffected — they remove immediately, as before.
 *
 * `--group <path>` is the batch form of the trae-cn link channel: it matches
 * every entry whose `groupPath` starts with the prefix, segment by segment (the
 * same rule `toggle --group` uses), and is mutually exclusive with name
 * patterns. A group matching several entries gets the same confirmation guard
 * as a broad glob, and an empty group is an error (exit 1), not an empty
 * success.
 *
 * `--json` (P0 §4.4) reports one result per resolved name. The broad-glob guard
 * deliberately keeps its behaviour under `--json`: the machine `OpsIO` is
 * non-interactive, so a multi-match glob without `--yes` is still refused
 * (exit 2) rather than confirmed — a JSON run configures nothing, and
 * "silently delete everything the glob matched" is not a safer default just
 * because the caller wants structured output. Pass `--yes` to proceed.
 */
export async function remove(argv, io = cliIO) {
    let opts;
    try {
        opts = parseRemoveArgs(argv);
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
    const { patterns, yes, json, group } = opts;
    // Project scope: exact link names only, no manifest read, no clone deletion.
    if (opts.project) {
        if (patterns.length === 0) {
            io.error('Usage: dsh-skills-nexus remove --project <name>... [--project-root <path>] [--json]');
            return 2;
        }
        return removeProject(opts, io);
    }
    if (group !== undefined && patterns.length > 0) {
        io.error('error: --group cannot be combined with name patterns');
        return 2;
    }
    if (group === undefined && patterns.length === 0) {
        io.error('Usage: dsh-skills-nexus remove <name-or-pattern>... [--group <path>] [--json]');
        return 2;
    }
    // Machine mode: the shared code's human lines go to a silent sink so stdout
    // stays pure JSON; diagnostics keep flowing to stderr.
    const out = json ? jsonIO(io) : io;
    const manifest = await readManifest();
    const allNames = manifest.skills.map((s) => s.name);
    // Resolve tokens → an ordered, de-duplicated list of names, tracking per-token
    // failures (a glob that matched nothing) and whether any single glob expanded
    // to multiple skills (which triggers the confirmation guard).
    const resolved = [];
    const push = (n) => {
        if (!resolved.includes(n))
            resolved.push(n);
    };
    let failures = 0;
    let broadGlobToken;
    let groupToken;
    /** Per-token resolution failures, so `--json` can report them too. */
    const unresolved = [];
    if (group !== undefined) {
        // Segment-exact prefix match — the same rule as `toggle --group`. A joined
        // string `startsWith` would let 'trae-cn/skill' match 'trae-cn/skills/*'.
        const prefix = group.split('/');
        const matches = manifest.skills.filter((e) => {
            if (!e.groupPath)
                return false;
            return prefix.every((seg, i) => e.groupPath[i] === seg);
        });
        if (matches.length === 0) {
            // An empty group is an error, so it returns here rather than through the
            // `resolved.length === 0` early-exit below — that path emits
            // `emitRemovalReport(io, [])`, which would answer exit code 0 under
            // `--json`. Mirrors `toggle.ts`'s hand-written empty report.
            const msg = `no entries match group "${group}"`;
            if (json) {
                emitJson(io, { version: 1, results: [], summary: { removed: 0, failed: 1 } });
                io.error(`error: ${msg}\n`);
            }
            else {
                out.error(msg);
            }
            return 1;
        }
        for (const m of matches)
            push(m.name);
        // A group that expands to several entries is a broad deletion: track it so
        // the group guard below confirms before removing them all.
        if (matches.length > 1)
            groupToken = group;
    }
    else {
        for (const token of patterns) {
            if (hasMeta(token)) {
                const hits = matchNames(allNames, token);
                if (hits.length === 0) {
                    out.error(`No skills match pattern "${token}".`);
                    failures++;
                    unresolved.push(token);
                    continue;
                }
                if (hits.length > 1 && broadGlobToken === undefined)
                    broadGlobToken = token;
                for (const h of hits)
                    push(h);
            }
            else {
                push(token);
            }
        }
    }
    // Destructive-op guard: a glob that expanded to multiple skills must be
    // confirmed. Show the *full* deletion set (globs + literals) so the user sees
    // exactly what goes. On a non-TTY we cannot prompt, so refuse (exit 2).
    if (broadGlobToken !== undefined && !yes) {
        const list = resolved.join(', ');
        if (!io.interactive) {
            const message = `Pattern "${broadGlobToken}" matches ${resolved.length} skills: ${list}.\n` +
                `Refusing to remove multiple skills without confirmation in a non-interactive shell.\n` +
                `Re-run with --yes to remove them.`;
            if (json) {
                fatalJsonError(io, message);
                return 2;
            }
            io.error(message);
            return 2;
        }
        const ok = await io.confirm(`This will remove ${resolved.length} skill(s): ${list}.\n` +
            `Continue?`, false);
        if (!ok) {
            out.emit('Aborted — nothing removed.\n');
            return 0;
        }
    }
    // Group guard — independent from the broadGlobToken guard above. That one
    // tracks glob-token expansion; this one tracks `--group` prefix matches.
    // Both gate "multi-delete needs confirmation".
    if (groupToken !== undefined && !yes) {
        const list = resolved.join(', ');
        if (!io.interactive) {
            const message = `Group "${groupToken}" matches ${resolved.length} skills: ${list}.\n` +
                `Refusing to remove multiple skills without confirmation in a non-interactive shell.\n` +
                `Re-run with --yes to remove them.`;
            if (json) {
                fatalJsonError(io, message);
                return 2;
            }
            io.error(message);
            return 2;
        }
        const ok = await io.confirm(`This will remove ${resolved.length} skill(s): ${list}.\n` +
            `Continue?`, false);
        if (!ok) {
            out.emit('Aborted — nothing removed.\n');
            return 0;
        }
    }
    if (resolved.length === 0) {
        // Every token was a zero-match glob (already reported above).
        if (json)
            return emitRemovalReport(io, unresolved.map(unresolvedResult));
        return failures > 0 ? 1 : 0;
    }
    const results = unresolved.map(unresolvedResult);
    let removedCount = 0;
    for (const name of resolved) {
        let removed;
        let links = [];
        try {
            // The deletion itself lives in src/remove.ts — one core shared with the
            // plugin's POST /remove route, so the two faces cannot drift apart.
            const res = await withSkillFileLock(name, () => removeSkill(name));
            removed = res.removed;
            links = res.links;
        }
        catch (err) {
            if (err instanceof SkillLockedError) {
                out.error(err.message);
                failures++;
                results.push({ name, status: 'failed', error: err.message });
                continue;
            }
            throw err;
        }
        if (removed) {
            removedCount++;
            out.emit(`Removed "${name}" — symlink(s) deleted, repo dir removed.\n`);
            results.push({ name, status: 'removed', links });
        }
        else {
            failures++;
            out.error(`No skill named "${name}".`);
            results.push({ name, status: 'not-found' });
        }
    }
    if (json)
        return emitRemovalReport(io, results);
    if (resolved.length > 1) {
        out.emit(`\n${removedCount}/${resolved.length} skill(s) removed` +
            (failures > 0 ? `, ${failures} not found / failed` : '') +
            `.\n`);
    }
    return failures === 0 ? 0 : 1;
}
/** A zero-match glob token, reported as its own `not-found` item. */
function unresolvedResult(token) {
    return { name: token, status: 'not-found' };
}
/** Write the `remove --json` report and derive the exit code from it. */
function emitRemovalReport(io, results) {
    const failed = results.filter((r) => r.status !== 'removed').length;
    emitJson(io, {
        version: 1,
        results,
        summary: { removed: results.length - failed, failed },
    });
    return failed === 0 ? 0 : 1;
}
/**
 * `remove --project <name>...`: remove links from `<project>/.dsh/skills`.
 *
 * Each name is handled independently — a missing name or user content does not
 * stop the rest — and only a proven link is ever deleted. The `not-a-link`
 * refusal is the whole point of project scope: a vendored directory or file is
 * reported in the same words the CLI uses for user content, and the exit code
 * is non-zero so a script cannot mistake the refusal for a removal.
 */
async function removeProject(opts, io) {
    const scope = await resolveProjectScope(opts.projectRoot);
    if ('error' in scope) {
        io.error(`error: ${scope.error}`);
        return 1;
    }
    // Machine mode keeps stdout pure: the one report is the only stdout writer.
    const out = opts.json ? jsonIO(io) : io;
    const results = [];
    let removed = 0;
    for (const name of opts.patterns) {
        const status = await removeProjectLink(scope.root, name);
        if (status === 'removed') {
            removed++;
            out.emit(`Removed link "${name}" — its target directory is untouched.\n`);
            results.push({ name, status });
        }
        else if (status === 'not-found') {
            io.error(`No project skill named "${name}".`);
            results.push({ name, status });
        }
        else {
            const message = `"${name}" is not a link — refusing to remove user files`;
            io.error(message);
            results.push({ name, status, error: message });
        }
    }
    const failed = results.length - removed;
    if (opts.json) {
        emitJson(io, { version: 1, results, summary: { removed, failed } });
        return failed === 0 ? 0 : 1;
    }
    if (results.length > 1)
        out.emit(`\n${removed}/${results.length} link(s) removed.\n`);
    return failed === 0 ? 0 : 1;
}
/**
 * True when the argv the parser just rejected asked for the JSON contract, so
 * a usage error still answers in the machine dialect on stderr (P0 §4.6).
 */
function jsonRequested(argv) {
    return argv.some((a) => a === '--json' || a.startsWith('--json='));
}
//# sourceMappingURL=remove.js.map
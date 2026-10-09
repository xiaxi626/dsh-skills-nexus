import { listEntries, readManifest } from '../../manifest.js';
import { REPOS_DIR, OFFICIAL_SKILLS_DIR, repoDir } from '../../paths.js';
import { stat } from 'node:fs/promises';
import { isEntryEnabled } from '../../link.js';
import { cliIO } from '../../ops-io.js';
import { parseListArgs } from '../args.js';
import { emitJson, fatalJsonError } from '../json-io.js';
import { matchesQuery } from '../../filter.js';
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
export async function list(argv, io = cliIO) {
    let names;
    let json;
    let filter;
    try {
        const opts = parseListArgs(argv);
        names = opts.names;
        json = opts.json;
        filter = opts.filter;
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
    if (json)
        return listJson(io, filter);
    const manifest = await readManifest();
    // Apply --filter before any output mode: the filter narrows the entry set
    // for --names, the default table and --json alike.
    const skills = filter
        ? manifest.skills.filter((s) => matchesQuery(s, filter))
        : manifest.skills;
    if (names) {
        for (const s of skills)
            io.emit(`${s.name}\n`);
        return 0;
    }
    if (skills.length === 0) {
        io.emit('No skills registered. Add one with: dsh-skills-nexus add github:owner/repo\n');
        return 0;
    }
    const rows = [];
    for (const s of skills) {
        const dir = repoDir(s.path);
        let present = 'missing';
        try {
            await stat(dir);
            present = 'ok';
        }
        catch {
            present = 'missing';
        }
        const linked = await isEntryEnabled(s);
        const state = linked ? 'on ' : 'off';
        rows.push([
            state,
            s.name,
            sourceLabel(s.gitUrl || s.url),
            s.subdir ?? '—',
            s.ref,
            s.commit ? short(s.commit) : '—',
            s.locked === true ? 'yes' : '—',
            present,
            s.updatedAt ? relative(s.updatedAt) : '—',
        ]);
    }
    const nameW = Math.max(4, ...rows.map((r) => r[1].length));
    const srcW = Math.max(6, ...rows.map((r) => r[2].length));
    const subW = Math.max(6, ...rows.map((r) => r[3].length));
    io.emit(`    ${'NAME'.padEnd(nameW)}  ${'SOURCE'.padEnd(srcW)}  ${'SUBDIR'.padEnd(subW)}  REF           COMMIT    LOCK  DIR      UPDATED\n`);
    for (const r of rows) {
        io.emit(`${r[0]}  ${r[1].padEnd(nameW)}  ${r[2].padEnd(srcW)}  ${r[3].padEnd(subW)}  ${r[4].padEnd(13)}${r[5].padEnd(10)}${r[6].padEnd(6)}${r[7].padEnd(9)}${r[8]}\n`);
    }
    io.emit(`\n${rows.length} skill(s) · repos: ${REPOS_DIR}\n` +
        `  Symlinks in: ${OFFICIAL_SKILLS_DIR} (on = linked to catalog)\n`);
    return 0;
}
/**
 * `list --json` (P0 §4.1): the structured inventory, built from `listEntries()`
 * — the same core behind `GET /skills-nexus/list` — so the CLI and the panel
 * report one dataset. `version` and the 2-space framing come from `emitJson`.
 *
 * Field notes:
 *   - `commit` is the recorded lockfile-lite value, not a fresh `git rev-parse`;
 *     `list` has never shelled out to git and doing so here would make the
 *     machine path depend on the git binary being on PATH.
 *   - `hasGitSource` is the server-side predicate (`gitUrl.length > 0`), never
 *     derived from `url` — every entry has a `url` and it is never empty.
 *   - `ownership` is `managed` unless the entry records `external` (a
 *     `--link-only` adoption of a directory nexus does not own).
 *   - `links[].target` is an absolute path; its exact form is platform
 *     dependent and explicitly outside the contract (P0 §2.2).
 */
async function listJson(io, filter) {
    const listed = await listEntries();
    const filtered = filter
        ? listed.filter(({ entry }) => matchesQuery(entry, filter))
        : listed;
    const entries = filtered.map(({ entry, enabled, links, update }) => ({
        name: entry.name,
        url: entry.url,
        ref: entry.ref,
        subdir: entry.subdir ?? null,
        commit: entry.commit ?? null,
        ...(entry.locked === true ? { locked: true } : {}),
        hasGitSource: entry.gitUrl.length > 0,
        ownership: entry.ownership === 'external' ? 'external' : 'managed',
        enabled,
        links: links.map((l) => ({ linkName: l.name, target: l.target })),
        update: update === null
            ? null
            : {
                hasUpdate: update.hasUpdate,
                latestCommit: update.latestCommit,
                checkedAt: update.checkedAt,
            },
    }));
    const report = { version: 1, entries };
    emitJson(io, report);
    return 0;
}
/**
 * True when the argv the parser just rejected asked for the JSON contract, so
 * a usage error still answers in the machine dialect on stderr (P0 §4.6).
 * `--json=value` counts: that spelling is itself a usage error, and the caller
 * clearly meant the machine mode.
 */
function jsonRequested(argv) {
    return argv.some((a) => a === '--json' || a.startsWith('--json='));
}
/**
 * Derive a canonical `owner/repo` source label from a normalized git URL, so
 * entries added via different spec forms (`github:o/r`, `https://…/o/r.git`,
 * `o/r`) all group under the same string in `list`. Takes the last two
 * `/`- or `:`-delimited segments after stripping a trailing `.git`.
 *
 * Exported for unit testing — the derivation is pure (no FS, no I/O).
 */
export function sourceLabel(gitUrl) {
    const segs = gitUrl.replace(/\.git$/i, '').split(/[/:]/).filter(Boolean);
    if (segs.length >= 2)
        return `${segs[segs.length - 2]}/${segs[segs.length - 1]}`;
    return segs[0] ?? gitUrl;
}
function short(sha) {
    return sha.slice(0, 7);
}
function relative(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then))
        return iso;
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0)
        return 'today';
    if (days === 1)
        return '1d ago';
    if (days < 30)
        return `${days}d ago`;
    return new Date(iso).toISOString().slice(0, 10);
}
//# sourceMappingURL=list.js.map
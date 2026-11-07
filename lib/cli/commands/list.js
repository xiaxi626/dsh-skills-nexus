import { listEntries, readManifest } from '../../manifest.js';
import { REPOS_DIR, OFFICIAL_SKILLS_DIR, projectSkillsDir } from '../../paths.js';
import { entrySkillDir } from '../../external.js';
import { stat } from 'node:fs/promises';
import { scanEntryLinks } from '../../link.js';
import { projectReport } from '../../project.js';
import { cliIO } from '../../ops-io.js';
import { parseListArgs } from '../args.js';
import { emitJson, fatalJsonError } from '../json-io.js';
import { matchesQuery } from '../../filter.js';
import { resolveProjectScope } from '../project-scope.js';
import { detectProjectRoot } from '../../project-root.js';
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
    let opts;
    try {
        opts = parseListArgs(argv);
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
    // Project scope is a filesystem scan, not a manifest read, so it branches
    // before everything below (and before the global --json path).
    if (opts.project)
        return listProject(io, opts);
    if (opts.all)
        return listAll(io, opts);
    const { names, json, filter } = opts;
    if (json)
        return listJson(io, filter);
    const manifest = await readManifest();
    // Apply --filter before any output mode: the filter narrows the entry set
    // for --names, the default table and --json alike.
    const skills = filter
        ? manifest.skills.filter((s) => matchesQuery(s, filter))
        : manifest.skills;
    if (names) {
        // When a filter yields zero matches, tell the user rather than printing
        // a blank stream — scripts that split on newlines still get a single line
        // that does not match any real skill name, so the machine contract stays
        // safe while the human caller gets a useful diagnostic.
        if (filter && skills.length === 0) {
            io.emit(`No entries match "${filter}".\n`);
        }
        else {
            for (const s of skills)
                io.emit(`${s.name}\n`);
        }
        return 0;
    }
    if (skills.length === 0) {
        // A filter that matched nothing is a different situation from an empty
        // manifest: the user has entries but none match the query. Surfacing the
        // distinction avoids the misleading "No skills registered" hint when the
        // real issue is a typo or overly narrow filter.
        if (filter) {
            io.emit(`No entries match "${filter}".\n`);
        }
        else {
            io.emit('No skills registered. Add one with: dsh-skills-nexus add github:owner/repo\n');
        }
        return 0;
    }
    const rows = [];
    // One batched link scan for the whole table (P1), replacing a full
    // per-entry rescan inside `isEntryEnabled`. The `present` stat below stays
    // per-entry on purpose: link attribution says nothing about the directory
    // being on disk, so it is not mergeable into the scan.
    const linksByEntry = await scanEntryLinks(skills);
    for (const s of skills) {
        const dir = entrySkillDir(s);
        let present = 'missing';
        try {
            await stat(dir);
            present = 'ok';
        }
        catch {
            present = 'missing';
        }
        const linked = (linksByEntry.get(s.name) ?? []).length > 0;
        const state = linked ? 'on ' : 'off';
        rows.push([
            state,
            s.name,
            // External entries get an "ext" prefix on the SOURCE column.
            s.ownership === 'external' ? `ext:${sourceLabel(s.gitUrl || s.url)}` : sourceLabel(s.gitUrl || s.url),
            s.subdir ?? '—',
            s.ref,
            s.commit ? short(s.commit) : '—',
            s.locked === true ? 'yes' : '—',
            present,
            s.updatedAt ? relative(s.updatedAt) : '—',
            s.groupPath ? s.groupPath.join('/') : '—',
        ]);
    }
    const nameW = Math.max(4, ...rows.map((r) => r[1].length));
    const srcW = Math.max(6, ...rows.map((r) => r[2].length));
    const subW = Math.max(6, ...rows.map((r) => r[3].length));
    const grpW = Math.max(5, ...rows.map((r) => r[9].length));
    io.emit(`    ${'NAME'.padEnd(nameW)}  ${'SOURCE'.padEnd(srcW)}  ${'SUBDIR'.padEnd(subW)}  REF           COMMIT    LOCK  DIR      UPDATED     GROUP\n`);
    for (const r of rows) {
        io.emit(`${r[0]}  ${r[1].padEnd(nameW)}  ${r[2].padEnd(srcW)}  ${r[3].padEnd(subW)}  ${r[4].padEnd(13)}${r[5].padEnd(10)}${r[6].padEnd(6)}${r[7].padEnd(9)}${r[8].padEnd(12)}${r[9].padEnd(grpW)}\n`);
    }
    io.emit(`\n${rows.length} skill(s) · repos: ${REPOS_DIR}\n` +
        `  Symlinks in: ${OFFICIAL_SKILLS_DIR} (on = linked to catalog)\n`);
    return 0;
}
/**
 * `list --project`: scan `<project>/.dsh/skills` — the same directory the DSH
 * provider reads at project rank — and report what is there.
 *
 * The data source is the filesystem, never the manifest: a project skill is a
 * link (or user content) somebody put in that directory, and nexus has no
 * record of it. `--names` stays a newline stream; `--json` emits the
 * project-scope report; the human table keeps the `(dangling)` marker beside a
 * link whose target has disappeared.
 */
async function listProject(io, opts) {
    const scope = await resolveProjectScope(opts.projectRoot);
    if ('error' in scope) {
        io.error(`error: ${scope.error}`);
        return 1;
    }
    const query = opts.filter?.toLowerCase();
    const report = await projectReport(scope.root);
    const root = projectSkillsDir(scope.root);
    const match = (name, description, target) => query === undefined ||
        name.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query) ||
        (target ?? '').toLowerCase().includes(query);
    const folderSkills = report.folderSkills.filter((skill) => match(skill.name, skill.description, skill.resourceBase));
    const entries = report.entries.filter((entry) => match(entry.skill?.name ?? entry.name, entry.skill?.description ?? '', entry.target));
    const displayName = (entry) => entry.skill?.name ?? entry.name;
    if (opts.json) {
        emitJson(io, {
            version: 1,
            projectRoot: report.projectRoot,
            folderSkills,
            entries,
        });
        return 0;
    }
    if (opts.names) {
        const names = new Set();
        for (const skill of folderSkills)
            names.add(skill.name);
        for (const entry of entries)
            names.add(displayName(entry));
        for (const name of [...names].sort())
            io.emit(`${name}\n`);
        return 0;
    }
    if (folderSkills.length === 0 && entries.length === 0) {
        io.emit(`No skills found in ${report.projectRoot} or ${root}.\n`);
        return 0;
    }
    if (folderSkills.length > 0) {
        const nameW = Math.max(4, ...folderSkills.map((skill) => skill.name.length));
        io.emit(`Folder skills (${report.projectRoot}):\n`);
        for (const skill of folderSkills) {
            const state = !skill.valid
                ? 'invalid'
                : skill.disabled
                    ? 'disabled'
                    : skill.linked
                        ? `linked as ${skill.linkName ?? '?'}`
                        : 'linkable';
            const description = skill.description.replace(/\s+/g, ' ').trim() || '—';
            io.emit(`  ${skill.name.padEnd(nameW)}  ${state.padEnd(18)}  ${description}\n`);
        }
        io.emit('\n');
    }
    if (entries.length === 0) {
        io.emit(`No project skills in ${root}.\n`);
        return 0;
    }
    const stateOf = (entry) => entry.kind === 'link'
        ? !entry.enabled
            ? 'disabled'
            : entry.dangling
                ? 'dangling'
                : 'link'
        : entry.skill?.valid === false
            ? 'invalid'
            : 'files';
    const kindW = Math.max(4, ...entries.map((entry) => stateOf(entry).length));
    const nameW = Math.max(4, ...entries.map((entry) => displayName(entry).length));
    const entryW = Math.max(5, ...entries.map((entry) => entry.name.length));
    io.emit(`Project skills root (${root}):\n`);
    io.emit(`${'KIND'.padEnd(kindW)}  ${'NAME'.padEnd(nameW)}  ${'ENTRY'.padEnd(entryW)}  ${'TARGET'.padEnd(20)}  DESCRIPTION\n`);
    for (const entry of entries) {
        const state = stateOf(entry);
        const target = entry.target ?? '—';
        const description = entry.skill?.description.replace(/\s+/g, ' ').trim() ||
            entry.skill?.error ||
            '—';
        const marker = entry.dangling ? '  (dangling)' : '';
        io.emit(`${state.padEnd(kindW)}  ${displayName(entry).padEnd(nameW)}  ${entry.name.padEnd(entryW)}  ${target.padEnd(20)}  ${description}${marker}\n`);
    }
    io.emit(`\n${entries.length} project entr${entries.length === 1 ? 'y' : 'ies'} · ${root}\n`);
    return 0;
}
/**
 * `list --all`: the human-only joined view. Project entries and manifest
 * entries are joined by name, so a name present in both scopes is marked
 * `overrides` on the project side and `shadowed` on the global side — the
 * provider's own precedence, made visible.
 *
 * Machine consumers keep using `list --json` (manifest) and
 * `list --project --json` (filesystem): joining two different datasets into
 * one version-1 envelope would have changed neither contract for the better.
 */
async function listAll(io, opts) {
    const root = detectProjectRoot(process.cwd());
    const [report, global] = await Promise.all([projectReport(root), listEntries()]);
    const projectEntries = report.entries;
    const query = opts.filter;
    const displayName = (entry) => entry.skill?.name ?? entry.name;
    // A disabled project link does not shadow the global skill of that name.
    const projectNames = new Set(projectEntries.filter((entry) => entry.enabled).map(displayName));
    const globalNames = new Set(global.map((listed) => listed.entry.name));
    const rows = [];
    for (const entry of projectEntries) {
        const name = displayName(entry);
        if (!matchesProjectEntry(name, entry.skill?.description ?? '', entry.target, query))
            continue;
        rows.push({
            scope: 'project',
            name,
            state: !entry.enabled
                ? 'disabled'
                : globalNames.has(name)
                    ? 'overrides'
                    : entry.kind === 'files'
                        ? 'user files'
                        : '—',
            target: entry.target ?? '—',
        });
    }
    for (const listed of global) {
        if (query !== undefined && !matchesQuery(listed.entry, query))
            continue;
        rows.push({
            scope: 'global',
            name: listed.entry.name,
            state: projectNames.has(listed.entry.name) ? 'shadowed' : '—',
            target: sourceLabel(listed.entry.gitUrl || listed.entry.url),
        });
    }
    if (rows.length === 0) {
        io.emit(query === undefined ? 'No skills found.\n' : `No entries match "${query}".\n`);
        return 0;
    }
    const scopeW = Math.max(5, ...rows.map((row) => row.scope.length));
    const nameW = Math.max(4, ...rows.map((row) => row.name.length));
    const stateW = Math.max(5, ...rows.map((row) => row.state.length));
    io.emit(`${'SCOPE'.padEnd(scopeW)}  ${'NAME'.padEnd(nameW)}  ${'STATE'.padEnd(stateW)}  TARGET\n`);
    for (const row of rows) {
        io.emit(`${row.scope.padEnd(scopeW)}  ${row.name.padEnd(nameW)}  ${row.state.padEnd(stateW)}  ${row.target}\n`);
    }
    io.emit(`\n${projectEntries.length} project skill(s) · ${global.length} global entry(ies) · project root: ${root}\n`);
    return 0;
}
/** Does a project entry match a `--filter` query (name, description or target)? */
function matchesProjectEntry(name, description, target, query) {
    if (query === undefined)
        return true;
    const q = query.toLowerCase();
    return (name.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        (target ?? '').toLowerCase().includes(q));
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
        ...(entry.groupPath ? { groupPath: entry.groupPath } : {}),
        ...(entry.externalDir ? { externalDir: entry.externalDir } : {}),
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
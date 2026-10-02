import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { addEntry, readManifest } from './manifest.js';
import { repoDir } from './paths.js';
import { hasCollision, linkSkill, unlinkSkill } from './link.js';
import { previewSkills } from './resolve.js';
import { removeSkill } from './remove.js';
import { readZip } from './zip.js';
import { PACKAGE_MANIFEST, PACKAGE_SCHEMA, PACKAGE_VERSION } from './export.js';
import { normalizeSubdir, parseGitSpec, repoSlug, sanitizeName } from './git.js';
import { ensureDescription, normalizeSkillName } from './frontmatter.js';
import { installFromGit } from './install.js';
/**
 * `import` — channel C of the source & migration design
 * (`docs/source-and-migration-design.md` §4.2/§5/§10.2): rebuild entries from a
 * package that `export` produced, or from a package somebody else did.
 *
 * What makes this more than "unzip into repos/" is the label. When the package
 * carries `nexus-package.json` and the remote it records answers, the entry is
 * rebuilt through the **same install path as `add`** (`src/install.ts`) — a real
 * clone, updatable and switchable. Only when there is no source, or it cannot be
 * reached, does the payload land as a snapshot; even then the label's `enabled`
 * flag and link names are restored, so the receiving machine ends up looking
 * like the sending one. A package without a label (a bare zip, another tool's
 * export) is a *bare package*: its skills are found by the peel scan and land as
 * snapshots.
 *
 * Two boundaries from §4.2:
 *   - **the peel scan lives here**, not in the installer's three discovery
 *     rules. Those must keep matching what the official provider finds, so they
 *     cannot be loosened; a package is a foreign artifact and needs a more
 *     forgiving search (`skills/<name>/SKILL.md` is three levels deep and must
 *     work, and so must `repo-main/skills/<name>/SKILL.md`).
 *   - **`--dry-run` decides without touching nexus state.** It unpacks the
 *     archive into a temporary directory (that is how the payload is inspected
 *     at all) and it probes the recorded remote, but it registers nothing,
 *     clones nothing and links nothing.
 */
/** How long a `--dry-run` remote probe may take before it counts as a timeout. */
export const URL_CHECK_TIMEOUT_MS = 5000;
/** How many wrapper directories the peel scan removes before giving up. */
export const MAX_PEEL_DEPTH = 3;
const execFileAsync = promisify(execFile);
/** A package could not be read, understood or applied. */
export class ImportError extends Error {
    /** Stable machine-readable code (§10.4). */
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ImportError';
        this.code = code;
    }
}
/* ------------------------------------------------------------------ */
/* Staging                                                             */
/* ------------------------------------------------------------------ */
/**
 * Make the package readable as a directory tree. An archive is unpacked into a
 * fresh temporary directory (`readZip` has already enforced every static rule
 * and the size caps of §5); a directory source is used in place.
 */
export async function stagePackage(source) {
    let info;
    try {
        info = await stat(source);
    }
    catch {
        throw new ImportError('package-not-found', `no package at "${source}"`);
    }
    if (info.isDirectory()) {
        return { source, format: 'directory', root: source, cleanup: async () => { } };
    }
    let files;
    try {
        files = readZip(await readFile(source));
    }
    catch (err) {
        throw new ImportError('invalid-package', `"${source}" is not a readable package: ${err instanceof Error ? err.message : String(err)}`);
    }
    const root = await mkdtemp(join(tmpdir(), 'nexus-package-'));
    for (const file of files) {
        const dest = join(root, ...file.name.split('/'));
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, file.data);
    }
    return {
        source,
        format: 'zip',
        root,
        cleanup: async () => {
            await rm(root, { recursive: true, force: true });
        },
    };
}
/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */
/** Read and validate the label, when the package has one. */
async function readLabel(root) {
    let raw;
    try {
        raw = await readFile(join(root, PACKAGE_MANIFEST), 'utf8');
    }
    catch {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new ImportError('invalid-package', `${PACKAGE_MANIFEST} is not valid JSON`);
    }
    const label = parsed;
    if (label.schema !== PACKAGE_SCHEMA) {
        throw new ImportError('invalid-package', `${PACKAGE_MANIFEST} declares schema "${String(label.schema)}" (expected "${PACKAGE_SCHEMA}")`);
    }
    const version = typeof label.version === 'number' ? label.version : 0;
    if (version > PACKAGE_VERSION) {
        throw new ImportError('newer-package', `the package was written by a newer nexus (label version ${version} > ${PACKAGE_VERSION}); upgrade first`);
    }
    return {
        schema: PACKAGE_SCHEMA,
        version,
        exportedAt: label.exportedAt ?? '',
        generator: label.generator ?? '',
        skipped: Array.isArray(label.skipped) ? label.skipped : [],
        entries: Array.isArray(label.entries) ? label.entries : [],
    };
}
/** Every file below `dir`, relative to it with `/` separators. */
async function listFiles(dir, base = dir) {
    let dirents;
    try {
        dirents = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const dirent of dirents) {
        const abs = join(dir, dirent.name);
        if (dirent.isSymbolicLink())
            continue;
        if (dirent.isDirectory())
            out.push(...(await listFiles(abs, base)));
        else if (dirent.isFile())
            out.push(toPosix(relative(base, abs)));
    }
    return out;
}
function toPosix(p) {
    return sep === '/' ? p : p.split(sep).join('/');
}
function fromPosix(p) {
    return sep === '/' ? p : p.split('/').join(sep);
}
/** Absolute path of a package-relative root (`.` and `''` mean the package root). */
function atRoot(pkgRoot, rel) {
    return rel === '.' || rel === '' ? pkgRoot : join(pkgRoot, fromPosix(rel));
}
async function subdirectories(dir) {
    let dirents;
    try {
        dirents = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    return dirents
        .filter((d) => d.isDirectory() && !d.isSymbolicLink() && d.name !== '.git')
        .map((d) => d.name);
}
/**
 * Bounded search for markdown *below* the peel budget, used only to tell "there
 * is no skill here" apart from "the skills are nested deeper than the scan was
 * willing to peel" (§4.2 error grading — today both report the same message).
 *
 * Only markdown deeper than `MAX_PEEL_DEPTH` counts: a stray note next to the
 * package root is not a too-deep skill, it is the reason the scan found nothing
 * at all, and reporting it as "too deep" would send the user to `--subdir` for
 * a file that is already as shallow as it gets.
 */
async function findSkillFiles(dir, depth = 0, out = []) {
    if (depth > MAX_PEEL_DEPTH + 2)
        return out;
    let dirents;
    try {
        dirents = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const dirent of dirents) {
        if (dirent.name === '.git' || dirent.isSymbolicLink())
            continue;
        const abs = join(dir, dirent.name);
        if (dirent.isFile()) {
            if (depth > MAX_PEEL_DEPTH && (dirent.name === 'SKILL.md' || dirent.name.endsWith('.md'))) {
                out.push(abs);
            }
        }
        else if (dirent.isDirectory()) {
            await findSkillFiles(abs, depth + 1, out);
        }
    }
    return out;
}
/**
 * Peel scan (§4.2): accept the package root as soon as the installer's own rules
 * find skills in it; otherwise, while the root holds exactly one directory, that
 * directory becomes the root. Archiving wrappers (`repo-main/`, `export-2026/`)
 * and staging directories (`skills/`) therefore cost one peel each, and the
 * rules themselves never change — `skills/alpha/SKILL.md` is found by rule 2
 * *inside* `skills/`.
 */
async function peelScan(pkgRoot) {
    let root = '.';
    for (let peel = 0; peel <= MAX_PEEL_DEPTH; peel++) {
        const skills = await previewSkills(atRoot(pkgRoot, root));
        if (skills.length > 0)
            return { root, skills, peel };
        const children = await subdirectories(atRoot(pkgRoot, root));
        if (children.length !== 1)
            return undefined;
        root = root === '.' ? children[0] : `${root}/${children[0]}`;
    }
    return undefined;
}
/** Probe the recorded remote, distinguishing "no" from "no answer in time". */
async function probeRemote(url) {
    try {
        await execFileAsync('git', ['ls-remote', url], { timeout: URL_CHECK_TIMEOUT_MS });
        return 'reachable';
    }
    catch (err) {
        const e = err;
        return e?.killed === true || e?.signal === 'SIGTERM' ? 'timeout' : 'unreachable';
    }
}
/**
 * Whether the decision needs the remote at all. `--no-remote` and
 * `--no-net-check` exist so an offline import neither waits nor guesses, so the
 * probe must not run for them — `decide` would ignore its verdict anyway.
 */
function needsProbe(gitUrl, options) {
    return gitUrl.length > 0 && options.noRemote !== true && options.noNetCheck !== true;
}
function decide(gitUrl, ref, options, probe) {
    if (gitUrl.length === 0)
        return { kind: 'snapshot', reason: 'no-source' };
    if (options.noRemote === true)
        return { kind: 'snapshot', reason: 'no-remote' };
    if (options.noNetCheck === true)
        return { kind: 'snapshot', reason: 'not-checked' };
    if (probe === 'timeout')
        return { kind: 'snapshot', reason: 'timeout' };
    if (probe === 'unreachable')
        return { kind: 'snapshot', reason: 'unreachable' };
    return { kind: 'git', url: gitUrl, ref: ref || 'main' };
}
/** Restrict a labelled package to the entries the caller asked for. */
function selectEntries(label, options) {
    if (options.name !== undefined && label.entries.length > 1) {
        throw new ImportError('invalid-package', `--name works only for single-entry packages; this one has ${label.entries.length} entries`);
    }
    if (options.subdir === undefined)
        return label.entries;
    // Accept the entry name, its payload path (`skills/<name>`) or the last
    // segment of either: on the command line all three read as "that root".
    const wanted = normalizeSubdir(options.subdir);
    const leaf = wanted.split('/').filter(Boolean).pop() ?? wanted;
    const selected = label.entries.filter((e) => e.name === wanted || e.name === leaf || `skills/${e.name}` === wanted);
    if (selected.length === 0) {
        throw new ImportError('invalid-package', `the package has no entry named "${options.subdir}" ` +
            `(entries: ${label.entries.map((e) => e.name).join(', ') || 'none'})`);
    }
    return selected;
}
/** Decide what an import would do, without doing any of it. */
export async function planStaged(staged, options) {
    const label = await readLabel(staged.root);
    const manifest = await readManifest();
    const takenNames = new Set(manifest.skills.map((s) => s.name));
    const takenPaths = new Set(manifest.skills.map((s) => s.path));
    const probes = new Map();
    /** One probe per distinct remote, whatever the entry count. */
    const probeOf = async (url) => {
        const cached = probes.get(url);
        if (cached !== undefined)
            return cached;
        const verdict = await probeRemote(url);
        probes.set(url, verdict);
        return verdict;
    };
    const entries = [];
    let candidate;
    let peel = 0;
    const push = async (entry) => {
        const name = sanitizeName(entry.name);
        // The verdict below is only ever read when `needsProbe` was true; passing
        // 'unreachable' for the skipped cases keeps `decide`'s guards in one place.
        const probe = needsProbe(entry.gitUrl, options) ? await probeOf(entry.gitUrl) : 'unreachable';
        entries.push({
            name,
            root: entry.root,
            ...(entry.subdir === undefined ? {} : { subdir: entry.subdir }),
            skills: entry.skills.map((s) => ({ ...s, name: sanitizeName(s.name) || name })),
            enabled: entry.enabled,
            decision: decide(entry.gitUrl, entry.ref, options, probe),
            conflict: takenNames.has(name) || takenPaths.has(name),
            files: (await listFiles(atRoot(staged.root, entry.root))).length,
        });
    };
    if (label !== undefined) {
        for (const entry of selectEntries(label, options)) {
            const entryRoot = `skills/${entry.name}`;
            if (options.each === true && entry.skills.length > 1) {
                for (const skill of entry.skills) {
                    await push({
                        name: skill.name || `${entry.name}-${basename(skill.root)}`,
                        root: skill.root,
                        subdir: entry.subdir,
                        skills: [{ name: skill.name, root: skill.root, links: skill.links }],
                        enabled: entry.enabled !== false,
                        gitUrl: entry.gitUrl,
                        ref: entry.ref,
                    });
                }
                continue;
            }
            await push({
                name: options.name ?? entry.name,
                root: entryRoot,
                subdir: entry.subdir,
                skills: entry.skills.map((s) => ({ name: s.name, root: s.root, links: s.links })),
                enabled: entry.enabled !== false,
                gitUrl: entry.gitUrl,
                ref: entry.ref,
            });
        }
    }
    else {
        const requested = options.subdir === undefined ? undefined : normalizeSubdir(options.subdir);
        let scan;
        if (requested !== undefined) {
            // An explicit root skips the peel scan — this is what the
            // `skill-nested-too-deep` message tells the caller to do.
            const skills = await previewSkills(atRoot(staged.root, requested));
            if (skills.length === 0) {
                throw new ImportError('no-skill-found', `--subdir "${requested}" holds no SKILL.md in "${staged.source}"`);
            }
            scan = { root: requested, skills, peel: 0 };
        }
        else {
            scan = await peelScan(staged.root);
        }
        if (scan === undefined) {
            const found = await findSkillFiles(staged.root);
            if (found.length === 0) {
                throw new ImportError('no-skill-found', `"${staged.source}" holds no SKILL.md — this does not look like a skill package`);
            }
            const shown = found.slice(0, 3).map((f) => toPosix(relative(staged.root, f)));
            throw new ImportError('skill-nested-too-deep', `"${staged.source}" nests its skills deeper than ${MAX_PEEL_DEPTH} wrapper levels ` +
                `(found ${shown.join(', ')}${found.length > 3 ? ', …' : ''}); ` +
                `pass --subdir <path> to name the root explicitly`);
        }
        candidate = scan.root;
        peel = scan.peel;
        const base = sanitizeName(basename(resolve(staged.source)).replace(/\.zip$/i, ''));
        if (options.each === true && scan.skills.length > 1) {
            for (const skill of scan.skills) {
                const rel = toPosix(relative(atRoot(staged.root, scan.root), skill.resourceBase));
                const root = rel === '' ? scan.root : `${scan.root}/${rel}`;
                await push({
                    name: skill.name || sanitizeName(basename(rel)) || base,
                    root,
                    skills: [{ name: skill.name || sanitizeName(basename(rel)) || base, root, links: [] }],
                    enabled: true,
                    gitUrl: '',
                    ref: '',
                });
            }
        }
        else {
            await push({
                name: options.name ?? (base || 'imported-package'),
                root: scan.root,
                skills: scan.skills.map((s) => ({
                    name: s.name || base,
                    root: toPosix(relative(staged.root, s.resourceBase)) || scan.root,
                    links: [],
                })),
                enabled: true,
                gitUrl: '',
                ref: '',
            });
        }
    }
    const files = entries.reduce((sum, entry) => sum + entry.files, 0);
    return {
        source: staged.source,
        format: staged.format,
        labelled: label !== undefined,
        manifestOnly: label !== undefined && files === 0 && entries.length > 0,
        entries,
        skipped: label?.skipped ?? [],
        ...(candidate === undefined ? {} : { candidate }),
        peel,
        files,
    };
}
/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */
/**
 * Stage → plan → apply → clean up. With `dryRun` the plan comes back and nothing
 * else happens (`result` is `undefined`).
 */
export async function importPackage(options) {
    const staged = await stagePackage(options.source);
    try {
        const plan = await planStaged(staged, options);
        if (options.dryRun === true)
            return { plan };
        if (plan.manifestOnly) {
            throw new ImportError('nothing-to-import', `"${plan.source}" lists sources but carries no skill content — ` +
                `re-create those entries with \`add\` (or \`adopt\`) instead of importing files`);
        }
        if (plan.entries.length === 0) {
            throw new ImportError('nothing-to-import', `"${plan.source}" contains no entries to import`);
        }
        return { plan, result: await applyPlan(plan, staged, options) };
    }
    finally {
        await staged.cleanup();
    }
}
async function applyPlan(plan, staged, options) {
    const installed = [];
    const failed = [];
    for (const entry of plan.entries) {
        try {
            if (entry.conflict) {
                if (options.force !== true) {
                    throw new ImportError('already-registered', `"${entry.name}" is already registered; pass --force to replace it`);
                }
                // --force means replace, and the shared remove core is what "replace"
                // means everywhere else: unregister, unlink, delete what nexus owns.
                await removeSkill(entry.name);
            }
            else if (await hasCollision(entry.name)) {
                throw new ImportError('collision', `a file or directory named "${entry.name}" already exists in the official skills root`);
            }
            installed.push(entry.decision.kind === 'git'
                ? await installViaGit(entry, entry.decision, options)
                : await installAsSnapshot(entry, staged));
        }
        catch (err) {
            failed.push({ name: entry.name, reason: err instanceof Error ? err.message : String(err) });
        }
    }
    return { source: plan.source, installed, skipped: plan.skipped, failed };
}
/** Channel A: the label recorded a reachable remote, so rebuild a real clone. */
async function installViaGit(entry, decision, options) {
    const gitSpec = parseGitSpec(decision.url, decision.ref);
    const repoBase = sanitizeName(repoSlug(gitSpec));
    const subdir = entry.subdir === undefined ? undefined : normalizeSubdir(entry.subdir);
    const leaf = subdir === undefined
        ? undefined
        : sanitizeName(subdir.split('/').filter(Boolean).pop() ?? 'skill');
    const path = subdir === undefined ? repoBase : `${repoBase}-${leaf}`;
    options.io.progress('importing', `${entry.name} ← ${decision.url}`);
    const result = await installFromGit({
        spec: decision.url,
        gitSpec,
        subdir,
        skillName: entry.name,
        path,
        name: undefined,
        subdirLeaf: leaf,
        yes: options.yes,
        io: options.io,
    });
    // The install reports three outcomes: only `installed` registered anything.
    // A declined confirmation or a repository that yields no skills is a failure
    // *of this entry*, reported against it rather than thrown at the whole run.
    if (result.status !== 'installed' || result.entry === undefined) {
        throw new ImportError('install-refused', `"${entry.name}" was not installed from ${decision.url} (${result.status})`);
    }
    // The install links every skill it finds; a package that recorded this entry
    // as disabled must not end up enabled on the receiving machine (§4.2).
    if (!entry.enabled) {
        for (const link of result.links)
            await unlinkSkill(link);
    }
    return {
        name: entry.name,
        kind: 'git',
        links: entry.enabled ? result.links : [],
        enabled: entry.enabled,
        path: result.entry.path,
    };
}
/** Channel B: no usable source — copy the payload in and register a snapshot. */
async function installAsSnapshot(entry, staged) {
    const path = sanitizeName(entry.name);
    const dest = repoDir(path);
    const source = atRoot(staged.root, entry.root);
    await mkdir(dirname(dest), { recursive: true });
    await cp(source, dest, {
        recursive: true,
        force: true,
        filter: (src) => basename(src) !== '.git',
    });
    const parsed = await previewSkills(dest);
    if (parsed.length === 0) {
        await rm(dest, { recursive: true, force: true });
        throw new ImportError('no-skill-found', `"${entry.name}" holds no SKILL.md after copying`);
    }
    // The same install-time normalization every other channel does: the official
    // provider silently skips a skill whose name is invalid or whose description
    // is empty, so neither may survive an import.
    for (const skill of parsed) {
        if (skill.invalidName !== undefined) {
            await normalizeSkillName(skill.skillFile, sanitizeName(skill.invalidName));
        }
        if (skill.description.length === 0) {
            await ensureDescription(skill.skillFile, `Imported skill ${entry.name}`);
        }
    }
    await addEntry({
        name: entry.name,
        url: `package:${basename(resolve(staged.source))}`,
        gitUrl: '',
        ref: '',
        commit: '',
        path,
        addedAt: new Date().toISOString(),
    });
    const links = entry.enabled ? await restoreLinks(entry, dest, parsed) : [];
    return { name: entry.name, kind: 'snapshot', links, enabled: entry.enabled, path };
}
/**
 * Rebuild the links a package recorded, or derive them the way every install
 * path does: one skill → the entry name, several → the frontmatter name with the
 * entry name as fallback. Recorded links win, so an alias the sending machine
 * had survives the trip.
 */
async function restoreLinks(entry, dest, parsed) {
    const created = [];
    for (const skill of parsed) {
        const rel = toPosix(relative(dest, resolve(skill.resourceBase)));
        const planned = entry.skills.find((s) => entry.root === '.'
            ? s.root.endsWith(rel === '' ? '/' : `/${rel}`) || rel === ''
            : s.root === `${entry.root}${rel === '' ? '' : `/${rel}`}`);
        const recorded = planned?.links ?? [];
        const names = recorded.length > 0
            ? recorded
            : [derivedLinkName(parsed, skill, entry.name)];
        for (const name of names) {
            if (created.includes(name))
                continue;
            await linkSkill(name, resolve(skill.resourceBase));
            created.push(name);
        }
    }
    return created;
}
function derivedLinkName(parsed, skill, entryName) {
    const name = skill.invalidName !== undefined ? sanitizeName(skill.invalidName) : skill.name;
    return parsed.length === 1 ? entryName : name || entryName;
}
//# sourceMappingURL=import.js.map
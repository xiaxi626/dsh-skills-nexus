import { readdir } from 'node:fs/promises';
import { readManifest, findEntry } from '../../manifest.js';
import { repoDir, OFFICIAL_SKILLS_DIR, skillLinkPath } from '../../paths.js';
import { linkSkill, unlinkIfPointsInto, isEntryEnabled } from '../../link.js';
import { entrySkillDir } from '../../external.js';
import { previewSkills } from '../../resolve.js';
import { sanitizeName } from '../../git.js';
import { cliIO } from '../../ops-io.js';
import { withSkillFileLock, SkillLockedError } from '../../locks.js';
import { parseToggleArgs } from '../args.js';
import { jsonIO, emitJson, fatalJsonError } from '../json-io.js';
/**
 * `enable <name>...` / `disable <name>...` — toggle catalog visibility by
 * creating or removing symlinks in the official DSH skills root.
 *
 * The actual clone stays in ~/.dsh/skills-nexus/repos/. enable/disable just
 * controls whether symlinks exist in ~/.dsh/skills/ — lightweight and atomic.
 *
 * Like `remove`, this accepts several names in one run (gap-closure A3): each
 * name is processed independently, a name that is not registered is a per-item
 * failure that does not stop the rest, and the exit code is non-zero if any
 * item failed. `--json` (P0 §4.5) renders the batch as one report.
 *
 * Exit codes: 0 = all done (including "already in that state"), 1 = at least
 * one name failed, 2 = usage error.
 */
export async function toggle(argv, enabled, io = cliIO) {
    let names;
    let json;
    let group;
    try {
        const opts = parseToggleArgs(argv, enabled ? 'enable' : 'disable');
        names = opts.names;
        json = opts.json;
        group = opts.group;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (looksLikeJson(argv)) {
            fatalJsonError(io, message);
            return 2;
        }
        io.error(`error: ${message}`);
        return 2;
    }
    // --group mode: filter entries by groupPath prefix and toggle each match.
    if (group) {
        return toggleByGroup(group, names, enabled, json, io);
    }
    if (json)
        return toggleJson(names, enabled, io);
    const manifest = await readManifest();
    let failures = 0;
    for (const name of names) {
        const entry = findEntry(manifest, name);
        if (!entry) {
            io.error(`No skill named "${name}".`);
            failures++;
            continue;
        }
        failures += (await toggleOne(entry, name, enabled, io)) === 0 ? 0 : 1;
    }
    return failures === 0 ? 0 : 1;
}
/**
 * Toggle entries by group path prefix. Matches every entry whose `groupPath`
 * starts with the given prefix (split on `/`). When `names` is also given,
 * only matching entries whose name is in `names` are toggled.
 */
async function toggleByGroup(groupPath, names, enabled, json, io) {
    const prefix = groupPath.split('/');
    const manifest = await readManifest();
    const matches = manifest.skills.filter((e) => {
        if (!e.groupPath)
            return false;
        return prefix.every((seg, i) => e.groupPath[i] === seg);
    });
    // If explicit names were given, further filter to the intersection.
    const nameSet = names.length > 0 ? new Set(names) : null;
    const targets = nameSet ? matches.filter((e) => nameSet.has(e.name)) : matches;
    if (targets.length === 0) {
        const msg = `no entries match group "${groupPath}"${nameSet ? ' and the given names' : ''}`;
        if (json) {
            emitJson(io, { version: 1, results: [], summary: { toggled: 0, already: 0, failed: 1 } });
            io.error(`error: ${msg}\n`);
        }
        else {
            io.error(`${msg}\n`);
        }
        return 1;
    }
    if (json)
        return toggleJson(targets.map((e) => e.name), enabled, io);
    let failures = 0;
    for (const entry of targets) {
        failures += (await toggleOne(entry, entry.name, enabled, io)) === 0 ? 0 : 1;
    }
    return failures === 0 ? 0 : 1;
}
/**
 * The per-name path of the human (non-`--json`) run: short-circuits on the
 * already-in-that-state cases so no lock is taken, and shares `toggleLinks`
 * with the JSON path.
 *
 * Returns 0 on success (including a no-op) and 1 on failure, exactly the
 * per-item verdict the old single-name command returned.
 */
async function toggleOne(entry, name, enabled, io) {
    const alreadyEnabled = await isEntryEnabled(entry);
    if (enabled && alreadyEnabled) {
        io.emit(`Skill "${name}" is already enabled.\n`);
        return 0;
    }
    if (!enabled && !alreadyEnabled) {
        io.emit(`Skill "${name}" is already disabled.\n`);
        return 0;
    }
    try {
        return await withSkillFileLock(name, async () => {
            await toggleLinks(entry, name, enabled, io);
            return 0;
        });
    }
    catch (err) {
        if (err instanceof SkillLockedError) {
            io.error(err.message);
            return 1;
        }
        throw err;
    }
}
/** One `ToggleJsonResult` per given name, in argument order (P0 §4.5). */
async function toggleJson(names, enabled, io) {
    // The report's own channel is stdout; every human-facing line the shared
    // code would print goes to a silent sink so stdout stays pure JSON.
    const sink = jsonIO(io);
    const manifest = await readManifest();
    const results = [];
    for (const name of names) {
        const entry = findEntry(manifest, name);
        if (!entry) {
            results.push({ name, action: action(enabled), status: 'not-found', enabled: !enabled, linksChanged: 0, already: false });
            continue;
        }
        const wasEnabled = await isEntryEnabled(entry);
        if (wasEnabled === enabled) {
            results.push({ name, action: action(enabled), status: 'already', enabled, linksChanged: 0, already: true });
            continue;
        }
        try {
            const linksChanged = await withSkillFileLock(name, () => toggleLinks(entry, name, enabled, sink));
            results.push({ name, action: action(enabled), status: 'toggled', enabled, linksChanged, already: false });
        }
        catch (err) {
            if (err instanceof SkillLockedError) {
                results.push({ name, action: action(enabled), status: 'failed', enabled: !enabled, linksChanged: 0, already: false, error: err.message });
                continue;
            }
            throw err;
        }
    }
    const failed = results.filter((r) => r.status === 'not-found' || r.status === 'failed').length;
    emitJson(io, {
        version: 1,
        results,
        summary: { toggled: results.filter((r) => r.status === 'toggled').length, already: results.filter((r) => r.status === 'already').length, failed },
    });
    return failed === 0 ? 0 : 1;
}
function action(enabled) {
    return enabled ? 'enable' : 'disable';
}
/**
 * True when the argv the parser just rejected asked for the JSON contract.
 * Mirrors `parseListArgs`' rule: `--json=value` is itself a usage error, so a
 * rejected argv still names the machine contract and deserves machine-readable
 * error output rather than a human sentence on stderr (P0 §4.6).
 */
function looksLikeJson(argv) {
    return argv.some((a) => a === '--json' || a.startsWith('--json='));
}
/**
 * The symlink mutation behind enable/disable, extracted from `toggle` so it
 * runs under the per-skill cross-process lock (§7.3 layer 3). disable uses
 * §6.4 target attribution: every link whose readlink target lies inside the
 * entry's clone goes, regardless of its name.
 *
 * Returns the number of symlinks created or removed; the caller turns that
 * into either a human line or the JSON report's `linksChanged`.
 */
async function toggleLinks(entry, name, enabled, io) {
    const skillRoot = entrySkillDir(entry);
    // Attribution base: the clone root for managed entries, the externalDir for
    // new-style external entries (which carry externalDir). Old-style external
    // entries (from --link-only adoption) use repoDir like managed entries.
    const dir = (entry.ownership === 'external' && entry.externalDir) ? skillRoot : repoDir(entry.path);
    let count = 0;
    if (enabled) {
        // Re-discover skills and create symlinks for each one.
        const skills = await previewSkills(skillRoot);
        for (const s of skills) {
            const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name;
            const linkName = skills.length === 1 ? entry.name : (fmName || entry.name);
            try {
                await linkSkill(linkName, s.resourceBase);
                count++;
            }
            catch (err) {
                io.error(`  ⚠ failed to link "${linkName}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        io.emit(`Enabled "${name}" — ${count} symlink(s) created in ~/.dsh/skills/\n`);
    }
    else {
        // §6.4 target attribution: remove every link whose readlink target lies
        // inside this entry's clone — by ownership, not by name. This catches
        // manually renamed aliases the name rule would miss, and it needs no
        // previewSkills pass, so it still cleans up when the clone itself is
        // missing or broken.
        let names = [];
        try {
            names = await readdir(OFFICIAL_SKILLS_DIR);
        }
        catch {
            // skills root missing — nothing to remove
        }
        for (const linkName of names) {
            if (await unlinkIfPointsInto(skillLinkPath(linkName), dir))
                count++;
        }
        io.emit(`Disabled "${name}" — ${count} symlink(s) removed from ~/.dsh/skills/\n`);
    }
    return count;
}
//# sourceMappingURL=toggle.js.map
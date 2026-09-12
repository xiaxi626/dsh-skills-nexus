import { join } from 'node:path';
import { removeEntry, removeSkillDir, readManifest } from '../../manifest.js';
import { repoDir } from '../../paths.js';
import { unlinkSkill } from '../../link.js';
import { previewSkills } from '../../resolve.js';
import { sanitizeName } from '../../git.js';
import { confirm } from '../prompt.js';
import { hasMeta, matchNames } from '../glob.js';
import { parseRemoveArgs } from '../args.js';
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
 */
export async function remove(argv) {
    const { patterns, yes } = parseRemoveArgs(argv);
    if (patterns.length === 0) {
        process.stderr.write('Usage: dsh-skills-nexus remove <name-or-pattern>...\n');
        return 2;
    }
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
    for (const token of patterns) {
        if (hasMeta(token)) {
            const hits = matchNames(allNames, token);
            if (hits.length === 0) {
                process.stderr.write(`No skills match pattern "${token}".\n`);
                failures++;
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
    // Destructive-op guard: a glob that expanded to multiple skills must be
    // confirmed. Show the *full* deletion set (globs + literals) so the user sees
    // exactly what goes. On a non-TTY we cannot prompt, so refuse (exit 2).
    if (broadGlobToken !== undefined && !yes) {
        const list = resolved.join(', ');
        if (!process.stdin.isTTY) {
            process.stderr.write(`Pattern "${broadGlobToken}" matches ${resolved.length} skills: ${list}.\n` +
                `Refusing to remove multiple skills without confirmation in a non-interactive shell.\n` +
                `Re-run with --yes to remove them.\n`);
            return 2;
        }
        const ok = await confirm(`This will remove ${resolved.length} skill(s): ${list}.\n` +
            `Continue?`, false);
        if (!ok) {
            process.stdout.write('Aborted — nothing removed.\n');
            return 0;
        }
    }
    if (resolved.length === 0) {
        // Every token was a zero-match glob (already reported above).
        return failures > 0 ? 1 : 0;
    }
    let removedCount = 0;
    for (const name of resolved) {
        if (await removeOne(name)) {
            removedCount++;
            process.stdout.write(`Removed "${name}" — symlink(s) deleted, repo dir removed.\n`);
        }
        else {
            failures++;
            process.stderr.write(`No skill named "${name}".\n`);
        }
    }
    if (resolved.length > 1) {
        process.stdout.write(`\n${removedCount}/${resolved.length} skill(s) removed` +
            (failures > 0 ? `, ${failures} not found / failed` : '') +
            `.\n`);
    }
    return failures === 0 ? 0 : 1;
}
/**
 * Delete one skill by exact name: unregister it, remove every symlink that
 * pointed into its clone, then delete the clone directory. Returns false if the
 * name isn't registered. Logic is unchanged from the original single-name
 * `remove` — only the surrounding loop and messaging moved to the caller.
 */
async function removeOne(name) {
    const removed = await removeEntry(name);
    if (!removed)
        return false;
    // Remove symlinks for all discovered skills.
    const dir = repoDir(removed.path);
    const skillRoot = removed.subdir ? join(dir, removed.subdir) : dir;
    try {
        const skills = await previewSkills(skillRoot);
        for (const s of skills) {
            const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name;
            const linkName = skills.length === 1 ? removed.name : (fmName || removed.name);
            await unlinkSkill(linkName);
        }
        // Also try the entry name itself in case it's different
        if (skills.length > 1) {
            await unlinkSkill(removed.name);
        }
    }
    catch {
        // If the clone is missing/broken, just try the entry name.
        await unlinkSkill(removed.name);
    }
    await removeSkillDir(removed.path);
    return true;
}
//# sourceMappingURL=remove.js.map
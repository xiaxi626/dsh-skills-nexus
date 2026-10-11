import { join } from 'node:path';
import { discardLocalChanges, getCurrentBranch, getHeadCommit, restoreCheckout, sanitizeName } from './git.js';
import { ensureDescription, normalizeSkillName } from './frontmatter.js';
import { entryLinks, isLinked, linkSkill, unlinkSkill } from './link.js';
import { readManifest, writeManifest } from './manifest.js';
import { repoDir } from './paths.js';
import { previewSkills } from './resolve.js';
import { withManifestLock } from './locks.js';
export async function captureVersionState(entry) {
    const dest = repoDir(entry.path);
    return {
        entry: { ...entry },
        commit: await getHeadCommit(dest),
        branch: await getCurrentBranch(dest),
        links: await entryLinks(entry),
    };
}
/**
 * Only replace this entry, keeping other entries' concurrent writes intact.
 *
 * Wrapped in `withManifestLock`: the read → find → replace → write cycle
 * would otherwise race against a concurrent `addEntry` / `removeEntry` /
 * `markUpdated` from another process, silently losing the other writer's
 * changes. The per-skill lock is already held by the caller (update or
 * switch-version), but that lock fences git + link work — the manifest
 * lock is the inner fence around the JSON read-modify-write itself.
 */
export async function restoreEntry(entry) {
    return withManifestLock(async () => {
        const manifest = await readManifest();
        const index = manifest.skills.findIndex((s) => s.name === entry.name);
        if (index < 0)
            throw new Error(`Entry "${entry.name}" disappeared during version change`);
        manifest.skills[index] = { ...entry };
        await writeManifest(manifest);
    });
}
export async function normalizeCheckout(entry, io) {
    const dest = repoDir(entry.path);
    const skills = await previewSkills(entry.subdir ? join(dest, entry.subdir) : dest);
    for (const ps of skills) {
        const name = ps.invalidName ? sanitizeName(ps.invalidName) : (ps.name || entry.name);
        if (ps.invalidName) {
            await normalizeSkillName(ps.skillFile, name);
            io?.emit(`  ⚠ re-normalized name: "${ps.invalidName}" → "${name}"\n`);
        }
        if (!ps.description || ps.description.trim().length === 0) {
            await ensureDescription(ps.skillFile, name);
            io?.emit(`  ⚠ added missing description for "${name}"\n`);
        }
    }
    return skills;
}
export async function rebuildVersionLinks(state, skills, io) {
    const oldNames = new Set(state.links.map((l) => l.name));
    const links = state.links.length === 0 ? [] : skills.map((ps) => ({
        name: skills.length === 1 ? state.entry.name : (ps.invalidName ? sanitizeName(ps.invalidName) : ps.name) || state.entry.name,
        target: ps.resourceBase,
    }));
    // 不覆盖其他 entry 或用户文件；否则仅恢复本 entry 无法闭环。
    for (const l of links) {
        if (!oldNames.has(l.name) && await isLinked(l.name)) {
            throw new Error(`Link collision: "${l.name}" is not owned by "${state.entry.name}"`);
        }
    }
    for (const l of state.links)
        await unlinkSkill(l.name);
    for (const l of links)
        await linkSkill(l.name, l.target);
    const names = [...new Set(links.map((l) => l.name))];
    const dropped = [...oldNames].filter((name) => !names.includes(name));
    if (dropped.length > 0) {
        io?.emit(`  ⚠ dropped ${dropped.length} stale link(s) no longer provided upstream: ${dropped.join(', ')}\n`);
    }
    return names;
}
/** 每一项恢复均尝试执行；诊断不替代触发恢复的原始错误。 */
export async function restoreVersionState(state) {
    const failures = [];
    const attempt = async (stage, fn) => {
        try {
            await fn();
            return true;
        }
        catch (err) {
            failures.push(`${stage}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    };
    // 在恢复 checkout 前记录新链接，避免 Windows 上新目录消失后无法归属。
    let current = [];
    await attempt('capture links', async () => { current = await entryLinks(state.entry); });
    const dest = repoDir(state.entry.path);
    const checkoutRestored = await attempt('checkout', async () => {
        await discardLocalChanges(dest);
        await restoreCheckout(dest, state.commit, state.branch);
    });
    if (checkoutRestored)
        await attempt('frontmatter', () => normalizeCheckout(state.entry));
    for (const l of current)
        await attempt(`unlink ${l.name}`, () => unlinkSkill(l.name));
    for (const l of state.links)
        await attempt(`link ${l.name}`, () => linkSkill(l.name, l.target));
    await attempt('manifest', () => restoreEntry(state.entry));
    return failures;
}
export async function recoverVersionFailure(state, error) {
    const failures = await restoreVersionState(state);
    if (failures.length > 0) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nRecovery failed: ${failures.join('; ')}`, { cause: error });
    }
    throw error;
}
//# sourceMappingURL=version-state.js.map
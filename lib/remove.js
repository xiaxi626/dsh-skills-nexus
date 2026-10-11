import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { isExternalEntry, removeEntry, removeSkillDir } from './manifest.js';
import { repoDir } from './paths.js';
import { isLinked, unlinkSkill } from './link.js';
import { previewSkills } from './resolve.js';
import { sanitizeName } from './git.js';
import { rollbackPath } from './rollback.js';
/**
 * Unregister the entry `name`, delete the links its skills are exposed under,
 * and remove its clone directory.
 *
 * @param name - registered entry name.
 * @returns whether an entry was removed, plus the links deleted with it.
 */
export async function removeSkill(name) {
    const removed = await removeEntry(name);
    if (!removed)
        return { removed: false, links: [] };
    const dir = repoDir(removed.path);
    const skillRoot = removed.subdir ? join(dir, removed.subdir) : dir;
    const links = [];
    const unlink = async (linkName) => {
        if (await isLinked(linkName)) {
            await unlinkSkill(linkName);
            links.push(linkName);
        }
    };
    try {
        const skills = await previewSkills(skillRoot);
        for (const s of skills) {
            const fmName = s.invalidName ? sanitizeName(s.invalidName) : s.name;
            await unlink(skills.length === 1 ? removed.name : (fmName || removed.name));
        }
        // Also try the entry name itself in case it's different.
        if (skills.length > 1)
            await unlink(removed.name);
    }
    catch {
        // Malformed frontmatter and friends: fall back to the entry name. A missing
        // clone does not land here — the locator yields an empty list instead.
        await unlink(removed.name);
    }
    // An external (`--link-only`) entry only links a directory the user owns:
    // unregister and unlink, but never delete that directory.
    if (isExternalEntry(removed))
        return { removed: true, links };
    await removeSkillDir(removed.path);
    // The rollback JSON is keyed by entry name, not by clone path, so it
    // survives the clone deletion above. Clean it up here — a removed entry
    // has no use for its recovery point, and leaving it behind would leak
    // orphan files that accumulate over repeated add/remove cycles.
    await rm(rollbackPath(removed.name), { force: true }).catch(() => { });
    return { removed: true, links };
}
//# sourceMappingURL=remove.js.map
import { join } from 'node:path';
import { removeEntry, removeSkillDir } from '../../manifest.js';
import { repoDir } from '../../paths.js';
import { unlinkSkill } from '../../link.js';
import { previewSkills } from '../../resolve.js';
import { sanitizeName } from '../../git.js';
import { positional } from '../args.js';
/** `remove <name>` — delete the cloned dir, remove symlinks, and unregister. */
export async function remove(argv) {
    const name = positional(argv);
    if (!name) {
        process.stderr.write('Usage: dsh-skills-nexus remove <name>\n');
        return 2;
    }
    const removed = await removeEntry(name);
    if (!removed) {
        process.stderr.write(`No skill named "${name}".\n`);
        return 1;
    }
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
    process.stdout.write(`Removed "${name}" — symlink(s) deleted, repo dir removed.\n`);
    return 0;
}
//# sourceMappingURL=remove.js.map
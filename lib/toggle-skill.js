import { entryLinks, entryLinkCandidates, hasCollision, linkSkill, unlinkIfPointsInto } from './link.js';
import { entrySkillDir } from './external.js';
import { repoDir, skillLinkPath } from './paths.js';
import { previewSkills } from './resolve.js';
import { setEntryExcluded } from './manifest.js';
export class SkillToggleError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SkillToggleError';
    }
}
export async function toggleEntrySkill(entry, skillName, enabled) {
    const skillRoot = entrySkillDir(entry);
    const skills = await previewSkills(skillRoot);
    // A single-skill entry IS its one skill — the whole-entry toggle already
    // covers it, and a per-skill exclusion would only desync intent from state.
    if (skills.length === 1) {
        throw new SkillToggleError('single-skill', `Entry "${entry.name}" exposes a single skill; toggle the whole entry instead (drop --skill).`);
    }
    const candidate = entryLinkCandidates(entry, skills).find((c) => c.name === skillName);
    if (candidate === undefined) {
        throw new SkillToggleError('not-found', `No skill named "${skillName}" in entry "${entry.name}".`);
    }
    const excluded = new Set(entry.excluded ?? []);
    const wasExcluded = excluded.has(skillName);
    const links = await entryLinks(entry);
    const entryEnabled = links.length > 0;
    let linksChanged = 0;
    if (enabled) {
        excluded.delete(skillName);
        await setEntryExcluded(entry.name, [...excluded]);
        if (entryEnabled && !links.some((l) => l.name === skillName)) {
            if (await hasCollision(skillName)) {
                throw new SkillToggleError('collision', `A directory/file named "${skillName}" already exists in ~/.dsh/skills/ — remove it first.`);
            }
            await linkSkill(skillName, candidate.target);
            linksChanged = 1;
        }
    }
    else {
        excluded.add(skillName);
        await setEntryExcluded(entry.name, [...excluded]);
        // Attribution base mirrors toggleLinks: the externalDir for new-style
        // external entries, the clone root otherwise. Only a link pointing into
        // the entry goes — a same-named link elsewhere is not ours to remove.
        const dir = (entry.ownership === 'external' && entry.externalDir) ? skillRoot : repoDir(entry.path);
        if (await unlinkIfPointsInto(skillLinkPath(skillName), dir))
            linksChanged = 1;
    }
    const already = linksChanged === 0 && wasExcluded === !enabled;
    const final = await entryLinks(entry);
    return { linksChanged, already, enabled: final.length > 0 };
}
//# sourceMappingURL=toggle-skill.js.map
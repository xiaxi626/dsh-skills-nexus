import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { addEntry } from '../../manifest.js';
import { SKILLS_DIR, skillDir } from '../../paths.js';
import { cloneRepo, getDefaultBranch, parseGitSpec, repoSlug, sanitizeName, } from '../../git.js';
import { parseAddArgs } from '../args.js';
/**
 * `add` — clone a GitHub SKILL.md repo and register it in the manifest.
 *
 * The repo lands under <skills>/<path>/; the manifest stores how to re-fetch it
 * so `update` can fast-forward later. The skill is enabled by default.
 *
 * When the user does not specify a `#ref`, we detect the remote's default
 * branch via `git ls-remote --symref` instead of hardcoding `main`.
 */
export async function add(argv) {
    const { spec, name, ref } = parseAddArgs(argv);
    // Parse once to get the URL; we'll refine the ref below if needed.
    let gitSpec = parseGitSpec(spec, ref ?? 'main');
    // If user didn't pin a ref, detect the remote's default branch.
    if (!ref && !spec.includes('#')) {
        process.stdout.write(`Detecting default branch for ${gitSpec.url}…\n`);
        const detected = await getDefaultBranch(gitSpec.url);
        if (detected !== gitSpec.ref) {
            process.stdout.write(`  → using ${detected} (detected)\n`);
        }
        gitSpec = { ...gitSpec, ref: detected };
    }
    const path = sanitizeName(repoSlug(gitSpec));
    const skillName = sanitizeName(name ?? repoSlug(gitSpec));
    const dest = skillDir(path);
    await mkdir(dirname(dest), { recursive: true });
    process.stdout.write(`Cloning ${gitSpec.url} (ref: ${gitSpec.ref}) → ${dest}\n`);
    try {
        await cloneRepo(gitSpec, dest);
    }
    catch (err) {
        // Clean up any partially-created directory so a retry starts clean.
        await rm(dest, { recursive: true, force: true });
        throw err;
    }
    const entry = {
        name: skillName,
        url: spec,
        gitUrl: gitSpec.url,
        ref: gitSpec.ref,
        path,
        enabled: true,
        addedAt: new Date().toISOString(),
    };
    await addEntry(entry);
    await mkdir(SKILLS_DIR, { recursive: true });
    process.stdout.write(`Added skill "${skillName}" from ${spec}\n` +
        `  dir: ${dest}\n` +
        `  Run a DSH profile (or reload) to make it appear in the catalog.\n`);
    return 0;
}
//# sourceMappingURL=add.js.map
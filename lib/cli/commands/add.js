import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { addEntry } from '../../manifest.js';
import { SKILLS_DIR, skillDir } from '../../paths.js';
import { cloneRepo, getDefaultBranch, parseGitSpec, repoSlug, sanitizeName, } from '../../git.js';
import { classifyRepo } from '../../repo-kind.js';
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
    const { spec, name, ref, yes } = parseAddArgs(argv);
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
    // Inspect the cloned repo before registering it. This decides whether the
    // repo is a plain SKILL.md repo, a SKILL.md repo with a thin DSH plugin
    // wrapper, a pure DSH plugin, or something nexus cannot manage.
    const repoKind = await classifyRepo(dest);
    if (repoKind.kind === 'dsh-plugin') {
        process.stdout.write(`\nThis repository appears to be a DSH plugin rather than a SKILL.md repo.\n` +
            `It is not recommended to manage it with dsh-skills-nexus.\n` +
            `Please install it using that repository's own instructions, for example:\n` +
            `  dsh plugin --profile <name> add "${spec}"\n`);
        await rm(dest, { recursive: true, force: true });
        return 0;
    }
    if (repoKind.kind === 'unknown') {
        process.stderr.write(`\nNo SKILL.md file and no DSH plugin marker were found in this repository.\n` +
            `dsh-skills-nexus can only manage SKILL.md repositories.\n`);
        await rm(dest, { recursive: true, force: true });
        return 1;
    }
    if (repoKind.kind === 'wrapped-skill' && !yes) {
        const useNexus = await confirm(`This repository has both SKILL.md and a DSH plugin wrapper (${repoKind.markers.join(', ')}).\n` +
            `Do you want dsh-skills-nexus to ignore the wrapper and manage it as a plain SKILL.md repo?`, false);
        if (!useNexus) {
            process.stdout.write(`Aborted. If you want to install it as a DSH plugin, follow that repository's instructions, e.g.\n` +
                `  dsh plugin --profile <name> add "${spec}"\n`);
            await rm(dest, { recursive: true, force: true });
            return 0;
        }
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
/**
 * Ask a yes/no question on the terminal.
 *
 * If stdin is not a TTY, default to `defaultValue` instead of hanging. This
 * keeps automation from blocking forever while still allowing interactive use.
 */
async function confirm(question, defaultValue) {
    if (!input.isTTY)
        return defaultValue;
    const rl = createInterface({ input, output });
    try {
        const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
        const answer = (await rl.question(question + suffix)).trim().toLowerCase();
        if (answer === 'y' || answer === 'yes')
            return true;
        if (answer === 'n' || answer === 'no')
            return false;
        return defaultValue;
    }
    finally {
        rl.close();
    }
}
//# sourceMappingURL=add.js.map
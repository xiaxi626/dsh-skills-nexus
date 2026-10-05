import { repoDir } from '../../paths.js';
import { cliIO } from '../../ops-io.js';
import { SkillLockedError, withSkillFileLock } from '../../locks.js';
import { parseAdoptArgs } from '../args.js';
import { AdoptError, adoptSkill } from '../../adopt.js';
/**
 * `adopt <name> --url <repo> [--ref <ref>] [--subdir <path>] [--force] [--prune]`
 * — attach a git source to an entry that has none (channel D of the source &
 * migration design, §6/§10.1).
 *
 * Thin wrapper over `src/adopt.ts`: parse argv, hold the per-entry file lock
 * (§7.3 layer 3, the same lock `add`/`remove`/`toggle` take), run the shared
 * core, and turn its result into the lines the user needs — what the entry is
 * now, which links it exposes, and where the previous directory was kept.
 *
 * `--prune` deletes that backup; without it the path is printed, because the
 * only way back to a snapshot is the copy the adopt moved aside. Once the new
 * source looks right, the backup is the user's to delete, and until then
 * `doctor` will list it as an unreferenced directory under `repos/`.
 *
 * The plugin half reuses the core unchanged (a later commit); nothing about
 * what an adopt means is decided here.
 *
 * Exit codes: 0 = adopted, 1 = refused or failed (with the state restored),
 * 2 = usage error.
 */
export async function adopt(argv, io = cliIO) {
    let options;
    try {
        options = parseAdoptArgs(argv);
    }
    catch (err) {
        io.error(`${err instanceof Error ? err.message : String(err)}`);
        return 2;
    }
    try {
        const result = await withSkillFileLock(options.name, () => adoptSkill({
            name: options.name,
            url: options.url,
            force: options.force,
            prune: options.prune,
            ...(options.ref === undefined ? {} : { ref: options.ref }),
            ...(options.subdir === undefined ? {} : { subdir: options.subdir }),
            io,
        }));
        printResult(result, io);
        return 0;
    }
    catch (err) {
        if (err instanceof AdoptError) {
            io.error(err.message);
            return 1;
        }
        if (err instanceof SkillLockedError) {
            io.error(err.message);
            return 1;
        }
        io.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}
/** What the entry is now, and what happened to what it was. */
function printResult(result, io) {
    io.emit(`Adopted skill "${result.name}" from ${result.url}\n`);
    if (result.subdir !== undefined)
        io.emit(`  subdir: ${result.subdir}\n`);
    io.emit(`  repo dir: ${repoDir(result.path)}\n` +
        `  commit: ${result.commit === '' ? '(unknown)' : result.commit}\n` +
        `  skills: ${result.skills.join(', ') || result.name}\n`);
    io.emit(result.wasEnabled
        ? `  symlinks: ${result.links.length} skill(s) linked to ~/.dsh/skills/\n`
        : `  symlinks: none — the entry was disabled, and stays disabled\n`);
    if (result.normalized > 0) {
        io.emit(`  normalized: ${result.normalized} frontmatter field(s)\n`);
    }
    io.emit(`  the entry is updatable now: update / switch-version work on it\n`);
    if (result.pruned) {
        io.emit(`  the previous directory was removed (--prune)\n`);
    }
    else if (result.backup !== undefined) {
        io.emit(`  the previous directory is kept at ${result.backup}\n` +
            `    (delete it once this source looks right; doctor lists it until then)\n`);
    }
    io.emit(`  The skill(s) will appear in the DSH catalog on next reload.\n`);
}
//# sourceMappingURL=adopt.js.map
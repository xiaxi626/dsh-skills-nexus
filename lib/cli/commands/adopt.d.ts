import type { OpsIO } from '../../ops-io.js';
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
export declare function adopt(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=adopt.d.ts.map
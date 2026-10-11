import type { OpsIO } from '../../ops-io.js';
/**
 * `purge [--yes] [--json]` — clean up accumulated artifacts.
 *
 * Default mode is a dry-run: scan and report what would be deleted, but
 * touch nothing. Pass `--yes` to actually delete. The dry-run is the
 * deliberate default because the artifacts are harmless leftovers — a user
 * who runs `purge` without thinking should see what *would* go before it
 * goes.
 */
export declare function purge(argv: string[], io?: OpsIO): Promise<number>;
//# sourceMappingURL=purge.d.ts.map
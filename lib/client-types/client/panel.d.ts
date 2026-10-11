/**
 * The Settings panel: entry-granularity skill rows, an add form (git url), the
 * package-import row, the job progress view and the destructive-action confirm
 * flow.
 *
 * The panel mirrors the command surface: an add form (git url, with the
 * optional name / ref / subdir channels), the **package import row** (pick a
 * file → synchronous `--dry-run` preview → confirm → `202` job), an **"attach
 * source" action on source-less entries only** (`adopt`), an **export all**
 * button, and the job progress view. The destructive-action confirm flow takes
 * its wording from the server: the `409 confirm-required` question is the single
 * source of consequence text, and the panel only asks and retries. The preview
 * renders the four verdicts of the import decision through `describeDecision`,
 * the same function the CLI's `--dry-run` uses.
 *
 * ## Presentation
 *
 * **Atoms come from the host, layout comes from CSS Modules, theme comes from
 * `--dsw-*` tokens.** That is the platform's own arrangement, not a choice made
 * here: the host's primitives are "Cordis-free React primitives styled only
 * through `--dsw-*` tokens", and the host's client build compiles
 * `x.module.css` into a hashed class map plus a self-injecting `<style>` tag.
 *
 * So `StateDot` / `Button` / `Tag` / `Switch` / `Input` / `DisclosureRow` /
 * `TerminalBlock` / `RiskConfirmation` arrive already themed and already
 * accessible, and `panel.module.css` only *positions* them: density, spacing
 * and the row rhythm. The design draft's fixed three-hex-accent styling system
 * is deliberately not implemented — it would need per-theme maintenance and
 * would not follow the shell.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is one of the nine specifiers the
 * browser loader's `require` can answer (see `PLATFORM_MODULES` in
 * `tsdown.config.ts`), so importing it here costs the bundle nothing and ships
 * no second copy.
 *
 * ## Reconciliation
 *
 * A mutation marked `hotReload: 'pending'` polls the list (2s budget) until the
 * change is visible; `done` refreshes once; `unsupported` — the preserved
 * contract for watcher-less hosts — explains the restart downgrade.
 * `reconcileAfter` is the single funnel for all three.
 */
import type { ReactElement } from 'react';
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives';
import { matchesQuery } from '../filter.js';
import type { DoctorReport, Job, ListEntry, NexusApi } from './api.js';
/** Map route errors to one-line user-readable text (codes are the route contract). */
export declare function errorText(err: unknown): string;
/**
 * Lift the adopt backup path out of the settled job's output into a panel
 * notice. The route emits it as one output line (`previous directory kept as
 * <path>`); the wording below mirrors the CLI's own advice — delete it once
 * the new source looks right, doctor lists it until then.
 */
export declare function adoptBackupNotice(job: Job): string | null;
/** One entry's row state, as the status dot reports it. */
export declare function entryState(entry: ListEntry): StateDotState;
/** The one-line health summary under the list. */
export declare function healthSummary(report: DoctorReport): {
    state: StateDotState;
    text: string;
};
/** Does the entry match the search box? Delegated to the shared `filter.ts`. */
export { matchesQuery };
/**
 * The panel. `api` is injectable for tests; production builds bind the global
 * fetch. The instance MUST be render-stable: a per-render `createApi()` default
 * would change `refresh`'s identity every render, re-fire the list effect, and
 * loop the panel in a self-sustaining fetch storm. Lazy useState pins it for
 * the mount's lifetime; the prop stays the injection seam.
 */
export declare function NexusPanel({ api: apiProp }: {
    api?: NexusApi;
}): ReactElement;
interface EntryCardProps {
    entry: ListEntry;
    refValue: string;
    onRefChange: (value: string) => void;
    adoptValue: string;
    onAdoptChange: (value: string) => void;
    adoptSubdirValue: string;
    onAdoptSubdirChange: (value: string) => void;
    onToggle: (entry: ListEntry) => void;
    onUpdate: (entry: ListEntry) => void;
    onRemove: (entry: ListEntry) => void;
    onSwitchVersion: (entry: ListEntry) => void;
    onAdopt: (entry: ListEntry) => void;
}
/**
 * One entry row. Exported for `test/panel-render.test.ts`: the row is where
 * `hasGitSource` decides which actions exist (update/switch vs attach source)
 * and where `ownership: 'external'` decides what the meta column says, and both
 * are pure props → markup, so they can be rendered and asserted without a DOM,
 * a click, or a mounted effect.
 *
 * The `pin` disclosure is local state: only one row is ever expanded, and
 * `DisclosureRow` keeps the header/chevron behaviour consistent with the host's
 * own panels.
 */
export declare function EntryCard({ entry, refValue, onRefChange, adoptValue, onAdoptChange, adoptSubdirValue, onAdoptSubdirChange, onToggle, onUpdate, onRemove, onSwitchVersion, onAdopt, }: EntryCardProps): ReactElement;
//# sourceMappingURL=panel.d.ts.map
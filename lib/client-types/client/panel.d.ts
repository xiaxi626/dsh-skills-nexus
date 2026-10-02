/**
 * The Settings panel (§10.4): entry-granularity skill cards, an add form
 * (git url), the job progress view (§7.5) and the destructive-action confirm
 * flow (§12.2 — the server's `409 confirm-required` question is the single
 * source of consequence wording; the panel only asks and retries).
 *
 * The panel mirrors the command surface (§10.3): an add form (git url), the
 * **package import row** the retired `add-zip` row used to occupy (pick a file →
 * synchronous `--dry-run` preview → confirm → `202` job), an **"attach source"
 * action on source-less entries only** (`adopt`), the job progress view (§7.5)
 * and the destructive-action confirm flow (§12.2 — the server's
 * `409 confirm-required` question is the single source of consequence wording;
 * the panel only asks and retries).
 *
 * The preview renders the four verdicts of §10.2 through `describeDecision`,
 * the same function the CLI's `--dry-run` uses — the wording is shared, not
 * re-invented here.
 *
 * Styling stays deliberately structural (semantic elements, no stylesheet
 * dependency): the half runs inside the host Settings shell, and hooking the
 * host UI primitives is a later refinement — the contract proven here is the
 * data flow, not the pixels.
 *
 * §11 reconciliation is live: a mutation marked `hotReload: 'pending'` polls
 * the list (2s budget) until the change is visible; `done` refreshes once;
 * `unsupported` — the preserved contract for watcher-less hosts — explains
 * the restart downgrade. `reconcileAfter` is the single funnel for all three.
 */
import type { ReactElement } from 'react';
import type { ListEntry, NexusApi } from './api.js';
/**
 * The panel. `api` is injectable for future harness tests; production builds
 * bind the global fetch. The instance MUST be render-stable: a per-render
 * `createApi()` default would change `refresh`'s identity every render,
 * re-fire the list effect, and loop the panel in a self-sustaining fetch
 * storm (observed live as connection-pool exhaustion in the host browser).
 * Lazy useState pins it for the mount's lifetime; the prop stays the
 * test-injection seam.
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
    onToggle: (entry: ListEntry) => void;
    onUpdate: (entry: ListEntry) => void;
    onRemove: (entry: ListEntry) => void;
    onSwitchVersion: (entry: ListEntry) => void;
    onAdopt: (entry: ListEntry) => void;
}
/**
 * One entry row. Exported for `test/panel-render.test.ts`: the card is where
 * `hasGitSource` decides which actions exist (update/switch vs attach source),
 * and that decision is pure props → markup, so it can be rendered and asserted
 * without a DOM, a click, or a mounted effect.
 */
export declare function EntryCard({ entry, refValue, onRefChange, adoptValue, onAdoptChange, onToggle, onUpdate, onRemove, onSwitchVersion, onAdopt }: EntryCardProps): ReactElement;
export {};
//# sourceMappingURL=panel.d.ts.map
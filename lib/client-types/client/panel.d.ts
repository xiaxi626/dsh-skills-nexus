/**
 * The Settings panel (§10.4): entry-granularity skill cards, an add form
 * (git url), the job progress view (§7.5) and the destructive-action confirm
 * flow (§12.2 — the server's `409 confirm-required` question is the single
 * source of consequence wording; the panel only asks and retries).
 *
 * The zip upload row is gone with `add-zip` (design §8 phase 3): zip is no
 * longer an installation method, and the package channel (`import`) has not
 * reached the panel yet (§10.3). That row is where it will live.
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
import type { NexusApi } from './api.js';
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
//# sourceMappingURL=panel.d.ts.map
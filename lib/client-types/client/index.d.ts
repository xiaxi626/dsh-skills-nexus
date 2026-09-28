/**
 * Browser half — the Skills Nexus settings panel.
 *
 * Proven shape (Phase 0 probe, kept): package `dsh.client` metadata → `./client`
 * export → `__ModuleLoader__.load` closure factory → `ctx.slots` registration →
 * the section appears in Settings. Phase 3 swaps the probe body for the real
 * panel (entry cards, add form, job progress view, confirm flow) over the api
 * client in `./api.ts`.
 * @module dsh-skills-nexus/client
 */
/** Client-side loader diagnostics read this name. */
export declare const name = "dsh-skills-nexus-client";
/**
 * Services this half reaches through `ctx.<name>`.
 *
 * These are cordis *service* names, not package names: `slots` is registered
 * by the ui-slots package. Cordis refuses an undeclared property access —
 * `ctx.slots` without this list fails the whole loader entry with "cannot get
 * property slots without inject", which blanks the settings dialog rather
 * than degrading. (The package-name list in `dsh.client.inject` is a
 * different layer: the host's boot-graph ordering, not the runtime inject.)
 */
export declare const inject: string[];
/**
 * Register the settings page.
 * @param ctx - client context carrying the slots service.
 */
export declare function apply(ctx: any): void;
//# sourceMappingURL=index.d.ts.map
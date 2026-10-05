/**
 * Browser half — the Skills Nexus settings panel.
 *
 * Shape: package `dsh.client` metadata → `./client` export →
 * `__ModuleLoader__.load` closure factory → `ctx.slots` registration → the
 * section appears in Settings. The body is the real panel (entry rows, add
 * form, package import, job progress view, confirm flow) over the api client in
 * `./api.ts`.
 *
 * `settings.section` is the slot this panel has always used and it is the one
 * the running shell answers. The host's own plugin-inventory panel registers
 * into `settings.plugins.tab` instead (a `kind: 'list'` child of the *Plugins*
 * section), which would put this panel behind the Plugins nav entry rather than
 * giving it its own row — a deliberate information-architecture change, not a
 * presentation one, and therefore out of scope for a UI pass. Recorded here so
 * the next person does not "fix" it by accident.
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
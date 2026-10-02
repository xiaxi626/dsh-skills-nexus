/**
 * The 11 `/skills-nexus/*` routes (§7.1) as plain route specs over an
 * injected request/response surface — tests drive them without a server, and
 * `src/index.ts` owns the single `webServer.register` adaption (§7.4).
 *
 * One response dialect for every route (统一约定): success is
 * `{ data, hotReload }`; failures are `4xx/5xx { error, data? }`. Method
 * mismatches answer `405 + allow`. The mutation/network routes check same
 * origin (§12.1); `remove` additionally requires loopback.
 *
 * Long operations (add / update / switch-version) are accepted as
 * jobs (§7.5): locks are taken at acceptance (受理即锁 — per-skill in-process
 * flight, then the cross-process file lock), the handler answers
 * `202 { data: { jobId } }`, and the work runs in the background. remove /
 * toggle are second-scale local operations and stay synchronous (§7.5).
 *
 * `add-zip` is gone (§8 phase 3): zip is no longer an installation method, and
 * the package channel hasn't reached the panel yet (§10.3) — that row is where
 * `import` will live.
 *
 * The route cores call the same shared primitives as the CLI commands but
 * route all messaging through the job's OpsIO — the CLI commands keep their
 * argv/stdout/stderr presentation untouched (full CLI stderr→OpsIO 收编 is a
 * later phase).
 */
import type { RouteSpec } from './types.js';
export declare function createNexusRoutes(): RouteSpec[];
//# sourceMappingURL=routes.d.ts.map
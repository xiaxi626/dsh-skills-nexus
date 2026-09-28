/**
 * Shared helpers for the `/skills-nexus/*` routes: the unified response
 * envelope (§7.1 约定 2), method gating (约定 6), same-origin / loopback
 * guards (§12.1) and small body/query readers.
 */
import type { RouteRequest, RouteResponse } from './types.js';
export declare const JSON_HEADERS: {
    readonly 'content-type': "application/json; charset=utf-8";
    readonly 'cache-control': "no-store";
};
export type HotReload = 'pending' | 'done' | 'unsupported';
/**
 * §7.1 约定 2: success is `{ data, hotReload }`; the async-acceptance envelope
 * is exactly `202 { data: { jobId } }`, so `hotReload` is omitted when undefined.
 */
export declare function sendData(res: RouteResponse, data: unknown, hotReload?: HotReload, status?: number): void;
export declare function sendError(res: RouteResponse, status: number, error: string, data?: unknown, extraHeaders?: Record<string, string>): void;
/** §7.1 约定 6: method mismatch → `405 { error }` + `allow` header. */
export declare function requireMethod(req: RouteRequest, res: RouteResponse, method: string): boolean;
export declare function header(req: RouteRequest, name: string): string | undefined;
/**
 * §12.1 same-origin: a missing `Origin` passes — the host listens on loopback
 * and non-browser clients (curl, tests) send no Origin at all. A present but
 * host-mismatched Origin is rejected by the caller with 403.
 */
export declare function sameOrigin(req: RouteRequest): boolean;
export declare function isLoopback(req: RouteRequest): boolean;
/** Guard for the mutation/network routes: same-origin is mandatory (§12.1). */
export declare function requireMutationSafe(req: RouteRequest, res: RouteResponse): boolean;
/** Read the raw body up to `capBytes` (413 beyond). */
export declare function readBody(req: RouteRequest, capBytes: number): Promise<Buffer>;
/** Parse a JSON object body; `{}` when empty, 400 `invalid-json` otherwise. */
export declare function readJson(req: RouteRequest): Promise<Record<string, unknown>>;
/** Query string of the request URL, per the Node `req.url` shape. */
export declare function queryOf(req: RouteRequest): URLSearchParams;
export declare function strField(body: Record<string, unknown>, key: string): string | undefined;
export declare function boolField(body: Record<string, unknown>, key: string): boolean | undefined;
//# sourceMappingURL=util.d.ts.map
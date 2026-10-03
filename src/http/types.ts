/**
 * Structural types for the host webServer route surface (§7.4).
 *
 * The host package `@deepseek-ai/dsh-host-webserver` is an *optional* peer:
 * its routes are registered reflectively via `ctx.inject(['webServer'])`, so
 * these interfaces mirror the real req/res shapes (Node `IncomingMessage` /
 * `ServerResponse` subset) instead of importing host types. `src/index.ts`
 * adapts the registration; `src/http/routes.ts` builds plain specs that tests
 * can drive without a server.
 */

/** Plugin id — single source; `src/index.ts` re-exports it as `name`. */
export const PLUGIN_ID = 'dsh-skills-nexus'

/** Minimal request surface the nexus routes use (Node IncomingMessage-compatible). */
export interface RouteRequest {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
  on(event: 'end', cb: () => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

/** Minimal response surface (mirrors the Phase 0 ping probe's RouteResponse). */
export interface RouteResponse {
  writeHead(status: number, headers: Record<string, string>): unknown
  /** The host passes a raw Node ServerResponse; `end` accepts Buffer natively. */
  end(body?: string | Buffer): unknown
}

/** One `webServer.register` route spec. */
export interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: RouteRequest, res: RouteResponse) => void | Promise<void>
}

/** Route-level failure carrying its HTTP status and `{ error, data? }` envelope. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly data?: unknown,
  ) {
    super(error)
    this.name = 'HttpError'
  }
}

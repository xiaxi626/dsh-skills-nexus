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
export const PLUGIN_ID = 'dsh-skills-nexus';
/** Route-level failure carrying its HTTP status and `{ error, data? }` envelope. */
export class HttpError extends Error {
    status;
    error;
    data;
    constructor(status, error, data) {
        super(error);
        this.status = status;
        this.error = error;
        this.data = data;
        this.name = 'HttpError';
    }
}
//# sourceMappingURL=types.js.map
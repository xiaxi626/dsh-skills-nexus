/**
 * Cordis plugin entry point.
 *
 * Nexus is a CLI tool that manages git clones and creates symlinks in the
 * official DSH skills root (`~/.dsh/skills/`). The official filesystem provider
 * discovers skills through these symlinks — no custom provider registration
 * is needed at runtime; this entry only attaches the plugin's own HTTP routes.
 *
 * Registering nexus via `dsh plugin add` installs the package into the DSH
 * profile and adds this Cordis layer, but it does NOT put the
 * `dsh-skills-nexus` command on the shell PATH — that command comes from a
 * global npm install (`npm install -g`) or `npm link` during development.
 *
 * Inject strategy: the top-level `inject` stays empty so every host (web /
 * tui / headless) can boot this entry — a top-level `['webServer']` inject
 * would fail boot on hosts that never mount the web server service. The web
 * half attaches lazily via `ctx.inject(['webServer'])`, and every route
 * registration is owned by `ctx.effect`: the web server throws on duplicate
 * `(kind, path)` registrations, so a hot remount must release its own routes
 * instead of colliding with them.
 *
 * No skill provider is registered — discovery remains symlinks + the official
 * filesystem provider.
 *
 * Symlink-integrity diagnostics live in `src/health.ts` and are surfaced by
 * the `doctor` CLI command — not from this entry point, because a
 * startup-time warning has no verified visible output channel in DSH.
 */

/** Plugin id — matches the `cordis.patch.yml` insert id; the loader reads it for diagnostics. */
export const name = 'dsh-skills-nexus'

/**
 * Empty on purpose: a top-level `['webServer']` inject would fail boot on
 * every host that mounts no web server service. The web half attaches
 * lazily inside `apply()` instead.
 */
export const inject: string[] = []

/** Response surface the ping route uses (subset of `node:http` ServerResponse). */
interface RouteResponse {
  writeHead(status: number, headers: Record<string, string>): unknown
  end(body?: string): unknown
}

/** One `webServer.register` route spec (mirrors @deepseek-ai/dsh-host-webserver). */
interface WebRouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (_req: unknown, res: RouteResponse) => void | Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx?: any): void {
  // Still no provider registration — symlinks + the official filesystem
  // provider handle discovery; this entry only adds the plugin's own routes.
  if (!ctx?.inject) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.inject(['webServer'], (webCtx: any) => {
    // The registration disposer must be owned by an effect: the route table
    // throws on a duplicate (kind, path), so a hot remount has to release
    // its own registrations before re-adding them.
    const route = (spec: WebRouteSpec): void => {
      webCtx.effect(
        () => webCtx.webServer.register(spec),
        `webServer.register(${spec.path})`,
      )
    }

    route({
      kind: 'exact',
      path: '/skills-nexus/ping',
      handler: (_req: unknown, res: RouteResponse) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(
          JSON.stringify({
            data: { name, status: 'ok', now: new Date().toISOString() },
            hotReload: 'done',
          }),
        )
      },
    })
  })
}

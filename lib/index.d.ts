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
export declare const name = "dsh-skills-nexus";
/**
 * Empty on purpose: a top-level `['webServer']` inject would fail boot on
 * every host that mounts no web server service. The web half attaches
 * lazily inside `apply()` instead.
 */
export declare const inject: string[];
export declare function apply(ctx?: any): void;
//# sourceMappingURL=index.d.ts.map
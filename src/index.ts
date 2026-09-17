/**
 * Cordis plugin entry point.
 *
 * Nexus is a CLI tool that manages git clones and creates symlinks in the
 * official DSH skills root (`~/.dsh/skills/`). The official filesystem provider
 * discovers skills through these symlinks — no custom provider registration
 * is needed at runtime.
 *
 * Registering nexus via `dsh plugin add` installs the package into the DSH
 * profile and adds this Cordis layer, but it does NOT put the
 * `dsh-skills-nexus` command on the shell PATH — that command comes from a
 * global npm install (`npm install -g`) or `npm link` during development. The
 * `apply()` function is intentionally a no-op: all discovery is handled by
 * symlinks + the official filesystem provider, not by a runtime provider.
 *
 * Symlink-integrity diagnostics live in `src/health.ts` and are surfaced by
 * the (planned) `doctor` CLI command — not from this entry point, because a
 * startup-time warning has no verified visible output channel in DSH.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(_ctx?: any): void {
  // No provider registration — symlinks handle discovery.
}

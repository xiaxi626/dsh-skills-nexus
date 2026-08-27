/**
 * Cordis plugin entry point.
 *
 * Nexus is a CLI tool that manages git clones and creates symlinks in the
 * official DSH skills root (`~/.dsh/skills/`). The official filesystem provider
 * discovers skills through these symlinks — no custom provider registration
 * is needed at runtime.
 *
 * This entry point exists so that `dsh plugin add` installs the package
 * and makes the `dsh-skills-nexus` CLI command available. The `apply()`
 * function is intentionally a no-op: all discovery is handled by symlinks
 * + the official filesystem provider, not by a runtime provider.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(_ctx?: any): void {
  // No provider registration — symlinks handle discovery.
}

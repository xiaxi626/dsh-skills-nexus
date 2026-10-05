/**
 * CSS Modules type shim — the six-line form the host's own client packages
 * carry (e.g. `packages/client/ui-settings-plugin-inventory/src/css-modules.d.ts`).
 *
 * `tsdown` compiles `x.module.css` (via the `dsh-css-modules-inline` plugin in
 * `tsdown.config.ts`) into a hashed class map plus a self-injecting `<style>`
 * tag, but TypeScript only sees an import whose module has no declaration — and
 * `tsc -p tsconfig.client-types.json` runs over this tree to publish types.
 * This shim gives it a shape.
 *
 * `Record<string, string>` is deliberately loose rather than exact: the hashed
 * names are build output, so a literal type per class would have to be
 * hand-maintained and would be wrong the moment a class is renamed.
 *
 * The bare `*.css` line covers global (unhashed) stylesheets, which this plugin
 * does not currently use — kept so a future plain `.css` import does not become
 * a compile error nobody expects.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

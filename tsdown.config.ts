/**
 * Client-half bundle config, adapted from dsh-skill-hub's standalone preset
 * (which in turn vendors dsh-web-ui's shared/tsdown.client.ts).
 *
 * The browser half is not plain ESM: the web UI loads client plugins through
 * `window.__ModuleLoader__.load({ id, factory })`, a CJS closure factory
 * whose injected `require` answers only the loader's shared module table.
 * Everything outside that table must be inlined; everything inside it must
 * stay external — a require() the loader cannot answer is a guaranteed
 * runtime throw.
 *
 * Deliberately kept OUT of the default `build` script: tsdown requires
 * Node `^22.18.0 || >=24.11.0` while CI still tests Node 20, so wiring this
 * into `build` would break CI. Run `npm run build:client` before a profile
 * install or publish; the engine/matrix decision lands in Phase 5.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'

/**
 * Resolve a stylesheet import against its importer.
 *
 * The importer may arrive as a repo-relative path (`src/client/css-probe.ts`)
 * rather than an absolute one, so it is anchored to the working directory first
 * — otherwise a relative specifier is resolved against the wrong base and the
 * load fails with a doubled `src/src/...` path.
 */
function sourcePath(source: string, importer: string): string {
  if (!source.startsWith('.')) return source
  const base = dirname(resolvePath(importer))
  return resolvePath(base, source)
}

/** Plugin id stamped into the module-loader handoff. */
const ID = 'dsh-skills-nexus'

/**
 * The browser loader's shared module table — the only specifiers its injected
 * `require` can answer.
 *
 * **Nine entries, and they are the host's own list, not a vendored copy.**
 * Both independent authorities agree verbatim:
 *
 *   1. the platform source `packages/client/web/src/platform.ts`
 *      (`PLATFORM_MODULES`) in the deepseek-harness checkout at the release this
 *      plugin targets;
 *   2. the running shell's boot table — a byte scan of the shipped
 *      `dsh-web-frontend/dist/assets/index-*.js`, whose
 *      `function rM(){return{…}}` is passed to `__ModuleLoader__.create` as
 *      `staticModules`.
 *
 * The previous list here was inherited from a third-party vendored copy and was
 * wrong in both directions:
 *
 *   - **two phantom entries** — `@deepseek-ai/dsh-client-web-react` and
 *     `@deepseek-ai/dsh-client-schema-form` exist nowhere in the host (a whole
 *     archive byte scan finds neither string). Keeping them meant that if an
 *     import ever resolved to one, the bundle would emit a `require` the loader
 *     cannot answer — a guaranteed runtime throw;
 *   - **three missing entries** — `dsh-client-store`, `dsh-client-ui-primitives`
 *     and `dsh-client-ui-dockkit`. The middle one is the UI primitives package
 *     this panel now imports: left out of the table it would have been inlined,
 *     shipping a second copy of the host's primitives inside this bundle.
 *
 * Rule going forward: this table is a mirror, and the only sources of truth are
 * the platform source and the running shell's boot table. If a plugin needs a
 * module that is *not* here, declare it in `package.json`'s
 * `dsh.client.external` — the host preset merges that with its own baseline —
 * rather than hard-coding a longer list in this file.
 */
const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Browser-half bundle → lib/client.js. */
export default (): UserConfig[] => [{
  name: ID + '/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  // clean must stay off: tsc's lib/ output is emitted before tsdown runs.
  clean: false,
  plugins: [cssModulesPlugin()],
  deps: {
    // The table is the whole rule: listed specifiers stay external (the
    // loader's require answers them), everything else is forced into the
    // bundle — a require() the loader cannot answer is a runtime throw.
    neverBundle: [...PLATFORM_MODULES],
    alwaysBundle: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]

/**
 * CSS Modules for the plugin's own stylesheets.
 *
 * The host's client build runs a `dsh-css-modules-inline` plugin: `x.module.css`
 * is compiled to a **hashed class map** and a self-injecting `<style
 * data-plugin-css>` tag, so a plugin's styles ship inside its bundle, are scoped
 * to it, and are injected exactly once. That is the platform-designated channel
 * (the host's own primitives each carry a `.module.css`, styled only through
 * `--dsw-*` tokens), and this plugin is built standalone — the host preset is
 * not applied here — so the logic is ported.
 *
 * Implementation notes:
 *   - `lightningcss` does the transform with `pattern: '[hash]_[local]'`, the
 *     same hashing the host uses;
 *   - the virtual-id indirection (`\0dsh-css:` + the absolute path + `.mjs`)
 *     keeps these stylesheets away from tsdown's own CSS pipeline, which would
 *     otherwise require `@tsdown/css`. The `.mjs` suffix matters: tsdown's guard
 *     matches ids ending in `.css`, and the virtual id must not;
 *   - the injector guards on `document.querySelector('style[data-plugin-css=…]')`
 *     so a re-run (HMR, two instances) cannot append the same sheet twice.
 */
function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  const VIRTUAL_PREFIX = '\0dsh-css:'
  const VIRTUAL_SUFFIX = '.mjs'
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourcePath(source, importer) : source
      return VIRTUAL_PREFIX + abs + VIRTUAL_SUFFIX
    },
    async load(this: { addWatchFile(file: string): void }, virtualId: string) {
      if (!virtualId.startsWith(VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
      // The virtual id otherwise hides the physical stylesheet from the watch graph.
      this.addWatchFile(fileId)
      const { transform } = await import('lightningcss')
      const source = await readFile(fileId)
      const { code, exports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      // Sorted, and sorted *here* rather than left to insertion order:
      // lightningcss returns `exports` in an order that varies between runs, so
      // an unsorted map makes every build permute the emitted object's keys —
      // a byte-different `lib/client.js` from identical input, which turns
      // "commit the rebuilt artifact" into a diff nobody can review and defeats
      // any `git diff --exit-code -- lib` check. The host's own
      // `dsh-css-modules-inline` sorts for the same reason.
      const entries = Object.entries(exports ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )
      for (const [local, exp] of entries) classMap[local] = exp.name
      const css = code.toString()
      const tagId = `${ID}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  } as NonNullable<UserConfig['plugins']>[number]
}

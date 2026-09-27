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
import type { UserConfig } from 'tsdown'

/** Plugin id stamped into the module-loader handoff. */
const ID = 'dsh-skills-nexus'

/**
 * The browser loader's shared module table — the only specifiers its
 * injected `require` can answer (vendored from dsh-web-ui's
 * shared/web-platform.ts via dsh-skill-hub).
 */
const PLATFORM_MODULES: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-schema-form',
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

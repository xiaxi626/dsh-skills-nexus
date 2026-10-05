/**
 * Node loader hooks for the Node test run — see `test/register-css.mjs` for how
 * they are wired in and why.
 *
 * Node runs loader chains in registration order and this module is appended
 * *after* `tsx`, so it sees only what tsx declined to handle.
 */

const STYLE_EXTENSIONS = ['.css', '.module.css']

/** The browser-only primitives package redirected to its test stand-in. */
const PRIMITIVES_PACKAGE = '@deepseek-ai/dsh-client-ui-primitives'
const PRIMITIVES_STUB = new URL('./primitives-stub.mjs', import.meta.url).href

/** A stand-in for a CSS Modules class map: `styles.foo` → `'foo'`. */
const CLASS_MAP_PROXY = `
const cache = new Map()
const styles = new Proxy({}, {
  get(target, key) {
    if (typeof key !== 'string') return target[key]
    if (key === 'default' || key === '__esModule') return target[key]
    if (!cache.has(key)) cache.set(key, key)
    return cache.get(key)
  },
  has() {
    return true
  },
})
export default styles
export const __isCssStub = true
`

/**
 * Virtual scheme for stylesheets. The *resolve* hook has to be the one that
 * short-circuits: for an import specifier Node's default resolution runs first
 * and fails with ERR_MODULE_NOT_FOUND before any `load` hook is consulted, so a
 * loader that only implements `load` never sees the request.
 */
const STYLE_URL_PREFIX = 'dsh-css-stub:'
const STYLE_URL_SUFFIX = '.mjs'

export async function resolve(specifier, context, nextResolve) {
  // The real package is a browser library whose entry pulls in shiki, katex and
  // the markdown stack; see the stub's own header for the reasoning.
  if (specifier === PRIMITIVES_PACKAGE) {
    return { url: PRIMITIVES_STUB, format: 'module', shortCircuit: true }
  }
  if (STYLE_EXTENSIONS.some((ext) => specifier.endsWith(ext))) {
    return {
      url: `${STYLE_URL_PREFIX}${encodeURIComponent(specifier)}${STYLE_URL_SUFFIX}`,
      format: 'module',
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(STYLE_URL_PREFIX)) {
    return { format: 'module', shortCircuit: true, source: CLASS_MAP_PROXY }
  }
  return nextLoad(url, context)
}

/**
 * Node loader hooks that let `npm test` import the browser half as it really is.
 *
 * `src/client/panel.tsx` imports `./panel.module.css`, which the *browser* build
 * turns into a hashed class map plus an injected `<style>` tag
 * (`dsh-css-modules-inline` in `tsdown.config.ts`). Node has no such pipeline,
 * and `tsx` — which owns the `.ts`/`.tsx` hooks in `npm test` — throws on a
 * `.css` import it cannot resolve.
 *
 * Rather than stub the import out of the component (which would mean the test
 * renders a different module graph than the one that ships), this exposes a
 * loader chain that appends one hook *after* tsx's: every `.css` request becomes
 * a module exporting a `Proxy` whose property access returns the property name.
 *
 * That makes `styles.entryRow` evaluate to `'entryRow'`, which is enough for the
 * places the suite actually asserts on — that the markup renders, that the right
 * branch was taken, that a value round-trips — while keeping the real class-map
 * indirection in place. The hashes themselves are build output and are never
 * asserted on.
 *
 * Wired in through `package.json`: `node --import tsx --import ./test/register-css.mjs …`.
 * See `test/css-hook.mjs` for the hook itself.
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./css-hook.mjs', pathToFileURL(import.meta.filename))

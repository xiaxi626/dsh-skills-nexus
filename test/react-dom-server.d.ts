/**
 * Minimal declaration for `react-dom/server`, which ships no types of its own
 * and would otherwise need `@types/react-dom` as a new dev dependency for the
 * single call `test/panel-render.test.ts` makes.
 *
 * Only the surface that test uses is declared: `renderToStaticMarkup` returns
 * the markup as a string. Anything the test does not use should be added here
 * deliberately, together with the use.
 */
declare module 'react-dom/server' {
  import type { ReactElement } from 'react'

  /** Render a React tree to its initial HTML, without running effects. */
  export function renderToStaticMarkup(element: ReactElement): string
}

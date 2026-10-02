import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntryCard, NexusPanel } from '../src/client/panel.js'
import type { ListEntry, NexusApi } from '../src/client/api.js'

/**
 * The panel's rendering contract (§10.3), as far as a *static* render reaches.
 *
 * This is not a DOM test bench — `panel.tsx` keeps its `api` prop as the seam
 * for one — but the import row and the "attach source" action are decided by the
 * component's own first render, and that much needs no browser: one render per
 * fixture, asserting the markup. What it catches is exactly the class of
 * regression this change risks: a missing `hasGitSource` branch, a row that
 * fails to render, a thrown hook.
 *
 * **Deliberately out of scope**: anything that happens after mount. The static
 * renderer runs no effects, and the `mountApi` guard below makes that explicit
 * — `list()` never resolves, so nothing arrives to render either way. Clicks,
 * polling, the confirm flow and job progress are the route/client contracts,
 * covered in `test/api.test.ts` and `test/client-api.test.ts`.
 *
 * The panel is imported straight from source: `panel.tsx` carries the runtime
 * `React` import the classic-runtime transpilers need (see its own comment), so
 * no JSX-aware loader or pre-build step is involved here.
 */

/** An api whose `list()` never settles: the first render is all there is. */
function mountApi(): NexusApi {
  const notCalled = (name: string) => (): never => {
    throw new Error(`unexpected api.${name}() during a static render`)
  }
  return {
    list: () => new Promise(() => {}),
    doctor: notCalled('doctor'),
    add: notCalled('add'),
    importPreview: notCalled('importPreview'),
    importPackage: notCalled('importPackage'),
    adopt: notCalled('adopt'),
    remove: notCalled('remove'),
    update: notCalled('update'),
    checkUpdates: notCalled('checkUpdates'),
    switchVersion: notCalled('switchVersion'),
    toggle: notCalled('toggle'),
    job: notCalled('job'),
    cancelJob: notCalled('cancelJob'),
  } as unknown as NexusApi
}

test('the panel renders the package import row (§10.3)', () => {
  const html = renderToStaticMarkup(createElement(NexusPanel, { api: mountApi() }))
  assert.match(html, /import package/)
  assert.match(html, /type="file"/)
  assert.match(html, /accept="\.zip,application\/zip"/)
  // The preview button stays disabled until a file is chosen — the §10.3 flow
  // is pick → preview → confirm, never import-by-accident…
  assert.match(html, /<button type="button" disabled="">preview<\/button>/)
  // …and there is no "import" action on screen before a verdict exists.
  assert.doesNotMatch(html, />import</)
  // Zip is an upload, not an installation method: this is the row the retired
  // `add-zip` control used to occupy, and the route behind it is `import`.
  assert.doesNotMatch(html, /add-zip/)
  assert.doesNotMatch(html, /upload zip/)
})

test('the panel renders its empty state without inventing entries', () => {
  // `list()` never settles in `mountApi`, so this is the first render: the
  // panel is still loading and must not claim there are no skills yet.
  const html = renderToStaticMarkup(createElement(NexusPanel, { api: mountApi() }))
  assert.match(html, /loading…/)
  assert.doesNotMatch(html, /attach source/)
  assert.doesNotMatch(html, /no skills registered yet/)
})

/* ------------------------------------------------------------------ */
/* The card itself: `hasGitSource` decides which actions exist         */
/* ------------------------------------------------------------------ */

const noop = (): void => {}

/** One card, rendered from props alone — no list, no mount, no effects. */
function card(entry: ListEntry, adoptValue = ''): string {
  return renderToStaticMarkup(
    createElement(EntryCard, {
      entry,
      refValue: '',
      onRefChange: noop,
      adoptValue,
      onAdoptChange: noop,
      onToggle: noop,
      onUpdate: noop,
      onRemove: noop,
      onSwitchVersion: noop,
      onAdopt: noop,
    }),
  )
}

const gitEntry: ListEntry = {
  name: 'git-skill',
  url: 'github:owner/git-skill',
  ref: 'main',
  subdir: null,
  commit: 'abcdef1234567890',
  hasGitSource: true,
  enabled: true,
  links: [{ linkName: 'git-skill', skillName: 'git-skill', enabled: true }],
  update: null,
}

const snapshotEntry: ListEntry = {
  name: 'snap-skill',
  url: 'package:migrate.zip',
  ref: '',
  subdir: null,
  commit: null,
  hasGitSource: false,
  enabled: false,
  links: [],
  update: null,
}

test('a source-less card offers attach source and no update/switch', () => {
  const html = card(snapshotEntry)
  // §10.3: the adopt action is the one thing a snapshot can be given …
  assert.match(html, /attach source/)
  assert.match(html, /adopt/)
  assert.match(html, /package:migrate\.zip/)
  // … and the git-bound actions are absent, matching the server's
  // `400 not-a-git-clone` for update / switch-version.
  assert.doesNotMatch(html, />\s*update\s*</)
  assert.doesNotMatch(html, /pin to/)
  assert.doesNotMatch(html, /switch/)
  // The adopt button stays disabled until a url is typed — it is never guessed.
  assert.equal(html.split('disabled=""').length - 1, 1)
  assert.match(html, /placeholder="github:owner\/repo"/)
})

test('a git-backed card offers update/switch and never attach source', () => {
  const html = card(gitEntry)
  assert.match(html, /update/)
  assert.match(html, /pin to/)
  assert.match(html, /switch/)
  assert.doesNotMatch(html, /attach source/)
  assert.doesNotMatch(html, /adopt/)
})

test('a typed adopt url enables the action and is what gets sent', () => {
  const html = card(snapshotEntry, 'github:owner/real-repo')
  // The value round-trips into the input, so `onAdopt` sends exactly what the
  // user typed (the core refuses anything else: no url is ever inferred).
  assert.match(html, /value="github:owner\/real-repo"/)
  // With a url present the adopt button is live — and `remove` is never
  // disabled, so the only `disabled=""` left is… none at all on this card.
  assert.equal(html.split('disabled=""').length - 1, 0)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntryCard, NexusPanel, adoptBackupNotice, errorText } from '../src/client/panel.js'
import { ApiError } from '../src/client/api.js'
import type { Job, ListEntry, NexusApi } from '../src/client/api.js'

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
    export: notCalled('export'),
  } as unknown as NexusApi
}

test('the add form offers collapsed optional name / ref / subdir channels', () => {
  const html = renderToStaticMarkup(createElement(NexusPanel, { api: mountApi() }))
  // Collapsed by default — the disclosure carries no open attribute …
  assert.match(html, /<summary>optional: name \/ ref \/ subdir<\/summary>/)
  assert.doesNotMatch(html, /<details open/)
  // … but the three fields are in the markup, with the ref-precedence note
  // pinned in the placeholder (a #ref in the url wins over the ref input).
  assert.match(html, /placeholder="entry name override \(default: subdir leaf or repo slug\)"/)
  assert.match(html, /placeholder="branch\/tag \(a #ref in the url wins\)"/)
  assert.match(html, /placeholder="skills\/foo \(a repository-relative directory\)"/)
})

test('the panel renders the export-all button (channel C)', () => {
  const html = renderToStaticMarkup(createElement(NexusPanel, { api: mountApi() }))
  assert.match(html, />\s*export all\s*</)
})

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
function card(entry: ListEntry, adoptValue = '', adoptSubdirValue = ''): string {
  return renderToStaticMarkup(
    createElement(EntryCard, {
      entry,
      refValue: '',
      onRefChange: noop,
      adoptValue,
      onAdoptChange: noop,
      adoptSubdirValue,
      onAdoptSubdirChange: noop,
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
  // … with an optional subdir channel beside the url (the route and the
  // `AdoptBody` contract already read it — only the control was missing) …
  assert.match(html, /placeholder="optional, e\.g\. skills\/foo"/)
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

test('a typed adopt subdir round-trips into its input', () => {
  const html = card(snapshotEntry, 'github:owner/real-repo', 'skills/tools')
  assert.match(html, /value="skills\/tools"/)
})

/* ------------------------------------------------------------------ */
/* Pure mappings: errorText + the adopt backup notice                  */
/* ------------------------------------------------------------------ */

/** A minimal settled job record for the notice extractor. */
function job(id: string, status: Job['status'], extra: Partial<Job> = {}): Job {
  return { id, kind: 'update', name: 'demo', status, output: [], startedAt: 'now', ...extra }
}

test('errorText points the two adopt-only 409s at the CLI --force escape hatch', () => {
  // `--force` is structurally unreachable from the panel (the adopt button
  // only exists on source-less entries), so the wording must say where to go
  // instead of leaving the user guessing at a bare `409 skill-mismatch`.
  const mismatch = errorText(new ApiError(409, 'skill-mismatch'))
  assert.match(mismatch, /different skills/)
  assert.match(mismatch, /--force/)
  const hasSource = errorText(new ApiError(409, 'already-has-source'))
  assert.match(hasSource, /--force/)
})

test('errorText surfaces the export-failed message instead of a bare code', () => {
  // An empty manifest answers `400 export-failed` with the ExportError text in
  // `data.message`; the panel must show that, not the `${status} ${error}` dump.
  const withMessage = errorText(new ApiError(400, 'export-failed', { message: 'the manifest holds no entries to export' }))
  assert.equal(withMessage, 'the manifest holds no entries to export')
  // Without a message it falls back to advice rather than the bare code.
  const bare = errorText(new ApiError(400, 'export-failed'))
  assert.match(bare, /export failed/)
  assert.doesNotMatch(bare, /400 export-failed/)
})

test('adoptBackupNotice lifts the backup path out of the job output', () => {
  const withBackup = job('j', 'done', {
    kind: 'adopt',
    output: ['Attached github:owner/repo (main, abc1234) to "snap"', '  previous directory kept as /home/u/repos/snap.pre-adopt-1\n'],
  })
  const notice = adoptBackupNotice(withBackup)
  assert.ok(notice !== null)
  assert.match(notice, /\/home\/u\/repos\/snap\.pre-adopt-1/)
  assert.match(notice, /delete it once the new source looks right/)
  // Other jobs (and an adopt that pruned) produce no notice.
  assert.equal(adoptBackupNotice(job('j', 'done', { output: [] })), null)
})

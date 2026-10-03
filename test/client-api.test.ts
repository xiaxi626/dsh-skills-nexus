import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError,
  confirmQuestion,
  confirmable,
  createApi,
  isConfirmRequired,
  jobConfirmationQuestion,
  pollJob,
  PollTimeoutError,
  reconcileList,
  ReconcileTimeoutError,
} from '../src/client/api.js'
import type { ApiFetch, ApiFetchInit, Job, ListEntry } from '../src/client/api.js'

/**
 * Unit tests for the browser-half api client (src/client/api.ts, §10.1).
 *
 * The transport is injectable precisely for this: a recording fake fetch
 * answers every route with queued envelope objects — no server, no network,
 * no DOM. `src/client` is excluded from the main build tsconfig but visible
 * to this file through tsconfig.test.json's own exclude list.
 */

/* ------------------------------------------------------------------ */
/* Recording fake fetch                                                */
/* ------------------------------------------------------------------ */

interface RecordedCall {
  input: string
  init?: ApiFetchInit
}

interface QueuedResponse {
  status: number
  body: unknown
}

function fakeFetch(responses: QueuedResponse[]) {
  const calls: RecordedCall[] = []
  const fetchFn: ApiFetch = async (input, init) => {
    calls.push({ input, init })
    const next = responses.shift()
    if (next === undefined) throw new Error('no queued response left')
    return {
      status: next.status,
      json: async () => next.body,
    }
  }
  return { fetchFn, calls }
}

function ok(data: unknown, hotReload?: string): QueuedResponse {
  return { status: 200, body: hotReload === undefined ? { data } : { data, hotReload } }
}

function job(id: string, status: Job['status'], extra: Partial<Job> = {}): Job {
  return { id, kind: 'update', name: 'demo', status, output: [], startedAt: 'now', ...extra }
}

/* ------------------------------------------------------------------ */
/* Envelope + error dialect                                            */
/* ------------------------------------------------------------------ */

test('a success envelope unwraps data and hotReload', async () => {
  const { fetchFn } = fakeFetch([ok({ entries: [] }, 'done')])
  const api = createApi(fetchFn)
  const env = await api.list()
  assert.deepEqual(env.data, { entries: [] })
  assert.equal(env.hotReload, 'done')
})

test('a 202 acceptance envelope keeps jobId and omits hotReload', async () => {
  const { fetchFn } = fakeFetch([{ status: 202, body: { data: { jobId: 'job-1' } } }])
  const api = createApi(fetchFn)
  const env = await api.add({ url: 'github:owner/repo' })
  assert.deepEqual(env.data, { jobId: 'job-1' })
  assert.equal(env.hotReload, undefined)
})

test('an error envelope throws ApiError with status, code and data', async () => {
  const { fetchFn } = fakeFetch([
    { status: 409, body: { error: 'confirm-required', data: { question: 'Remove "x"?' } } },
  ])
  const api = createApi(fetchFn)
  await assert.rejects(api.remove('x'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 409)
    assert.equal(err.error, 'confirm-required')
    assert.deepEqual(err.data, { question: 'Remove "x"?' })
    return true
  })
})

test('a non-JSON body throws invalid-response', async () => {
  const fetchFn: ApiFetch = async () => ({
    status: 200,
    json: async () => {
      throw new SyntaxError('unexpected token')
    },
  })
  await assert.rejects(createApi(fetchFn).list(), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 200)
    assert.equal(err.error, 'invalid-response')
    return true
  })
})

test('a 200 body without a data key throws invalid-envelope', async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: { nope: true } }])
  await assert.rejects(createApi(fetchFn).list(), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.error, 'invalid-envelope')
    return true
  })
})

test('an error body without a known error code degrades gracefully', async () => {
  const { fetchFn } = fakeFetch([{ status: 500, body: {} }])
  await assert.rejects(createApi(fetchFn).list(), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 500)
    assert.equal(err.error, 'unknown-error')
    return true
  })
})

/* ------------------------------------------------------------------ */
/* Request shapes                                                      */
/* ------------------------------------------------------------------ */

test('add posts the url body as JSON with the content-type header', async () => {
  const { fetchFn, calls } = fakeFetch([{ status: 202, body: { data: { jobId: 'j' } } }])
  await createApi(fetchFn).add({
    url: 'github:owner/repo',
    name: 'short',
    ref: 'main',
    subdir: 'skills/foo',
  })
  const call = calls[0]!
  assert.equal(call.input, '/skills-nexus/add')
  assert.equal(call.init?.method, 'POST')
  assert.equal(call.init?.headers?.['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(call.init?.body as string), {
    url: 'github:owner/repo',
    name: 'short',
    ref: 'main',
    subdir: 'skills/foo',
  })
})

test('export posts the body as JSON', async () => {
  const { fetchFn, calls } = fakeFetch([{
    status: 200,
    body: { data: { out: '/x/y.zip', format: 'zip', entries: 1, files: 1, skipped: [] } },
  }])
  await createApi(fetchFn).export({ all: true })
  const call = calls[0]!
  assert.equal(call.input, '/skills-nexus/export')
  assert.equal(call.init?.method, 'POST')
  assert.equal(call.init?.headers?.['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(call.init?.body as string), { all: true })
})

test('add omits optional fields the caller did not provide', async () => {
  // The panel's own payload shape: stripped values must not ride along as
  // empty strings or undefined keys.
  const { fetchFn, calls } = fakeFetch([{ status: 202, body: { data: { jobId: 'j' } } }])
  await createApi(fetchFn).add({ url: 'github:owner/repo', confirm: true })
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), {
    url: 'github:owner/repo',
    confirm: true,
  })
})

test('remove/update default to confirm:false and forward confirm:true on demand', async () => {
  const { fetchFn, calls } = fakeFetch([
    ok({ name: 'a', removed: true, links: [] }, 'pending'),
    { status: 202, body: { data: { jobId: 'j1' } } },
    { status: 202, body: { data: { jobId: 'j2' } } },
  ])
  const api = createApi(fetchFn)
  await api.remove('a')
  await api.update('a')
  await api.update('a', true)
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { name: 'a', confirm: false })
  assert.deepEqual(JSON.parse(calls[1]!.init?.body as string), { name: 'a', confirm: false })
  assert.deepEqual(JSON.parse(calls[2]!.init?.body as string), { name: 'a', confirm: true })
})

test('toggle posts {name, enabled} and switch-version forwards the full body', async () => {
  const { fetchFn, calls } = fakeFetch([
    ok({ name: 'a', enabled: false, links: [] }, 'pending'),
    { status: 202, body: { data: { jobId: 'j' } } },
  ])
  const api = createApi(fetchFn)
  await api.toggle('a', false)
  await api.switchVersion({ name: 'a', ref: 'v1.0.0', refType: 'tag', confirm: true })
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { name: 'a', enabled: false })
  assert.deepEqual(JSON.parse(calls[1]!.init?.body as string), {
    name: 'a',
    ref: 'v1.0.0',
    refType: 'tag',
    confirm: true,
  })
})

test('job poll encodes the id into the query string', async () => {
  const { fetchFn, calls } = fakeFetch([ok({ job: job('job 1&x', 'done') }, 'done')])
  const env = await createApi(fetchFn).job('job 1&x')
  assert.equal(env.data.job.status, 'done')
  assert.equal(calls[0]!.input, '/skills-nexus/job?id=job%201%26x')
})

test('cancelJob posts {id}', async () => {
  const { fetchFn, calls } = fakeFetch([ok({ id: 'j', status: 'running' }, 'done')])
  await createApi(fetchFn).cancelJob('j')
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { id: 'j' })
})

/* ------------------------------------------------------------------ */
/* Package upload (§10.3) — raw body + filename header                 */
/* ------------------------------------------------------------------ */

/** The browser object the upload sends: only `name` and the bytes matter. */
function fakeFile(name: string, content = 'zip-bytes'): File {
  return {
    name,
    size: content.length,
    type: 'application/zip',
    bytes: async () => new TextEncoder().encode(content),
  } as unknown as File
}

test('importPreview uploads the file as the body with dryRun in the query', async () => {
  const plan = { source: 'pkg.zip', labelled: false, entries: [] }
  const { fetchFn, calls } = fakeFetch([ok({ plan }, 'done')])
  const file = fakeFile('my.skills.zip')
  const env = await createApi(fetchFn).importPreview(file)

  assert.deepEqual(env.data.plan, plan)
  const call = calls[0]!
  // The bytes are the body — not a JSON envelope, not multipart.
  assert.equal(call.init?.body, file)
  assert.equal(call.init?.method, 'POST')
  // The filename rides in a header, because the body is the package itself.
  assert.equal(call.init?.headers?.['x-nexus-filename'], 'my.skills.zip')
  assert.equal(call.init?.headers?.['content-type'], 'application/octet-stream')
  // §10.3 step 1: the preview is a dry run and can never import.
  const query = new URLSearchParams(call.input.split('?')[1]!)
  assert.equal(query.get('dryRun'), 'true')
  assert.equal(query.get('confirm'), 'false')
})

test('importPackage asks for the real run (confirm) and forwards the options', async () => {
  const { fetchFn, calls } = fakeFetch([{ status: 202, body: { data: { jobId: 'job-9' } } }])
  const env = await createApi(fetchFn).importPackage(fakeFile('pkg.zip'), {
    force: true,
    each: true,
    noNetCheck: true,
    subdir: 'skills/alpha',
  })

  assert.deepEqual(env.data, { jobId: 'job-9' })
  const call = calls[0]!
  const query = new URLSearchParams(call.input.split('?')[1]!)
  assert.equal(query.get('dryRun'), 'false')
  assert.equal(query.get('confirm'), 'true')
  assert.equal(query.get('force'), 'true')
  assert.equal(query.get('each'), 'true')
  assert.equal(query.get('noNetCheck'), 'true')
  assert.equal(query.get('subdir'), 'skills/alpha')
  // Options nobody set must not appear as "undefined" strings — the server
  // reads `flag()`/`strField` and would treat them as truthy garbage.
  assert.equal(query.has('name'), false)
  assert.equal(query.has('noRemote'), false)
})

test('adopt posts the entry name and the explicitly typed url as JSON', async () => {
  const { fetchFn, calls } = fakeFetch([{ status: 202, body: { data: { jobId: 'job-3' } } }])
  await createApi(fetchFn).adopt({ name: 'snap', url: 'github:owner/repo', confirm: true })
  const call = calls[0]!
  assert.equal(call.input, '/skills-nexus/adopt')
  assert.equal(call.init?.headers?.['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(call.init?.body as string), {
    name: 'snap',
    url: 'github:owner/repo',
    confirm: true,
  })
})

/* ------------------------------------------------------------------ */
/* confirm-required retry flow (§7.1 约定 4 / §10.4)                   */
/* ------------------------------------------------------------------ */

test('isConfirmRequired / confirmQuestion classify only the 409 dialect', () => {
  const yes = new ApiError(409, 'confirm-required', { question: 'Really?' })
  const notStatus = new ApiError(400, 'confirm-required')
  const notCode = new ApiError(409, 'busy', { name: 'x' })
  assert.equal(isConfirmRequired(yes), true)
  assert.equal(isConfirmRequired(notStatus), false)
  assert.equal(isConfirmRequired(notCode), false)
  assert.equal(confirmQuestion(yes), 'Really?')
  assert.equal(confirmQuestion(notCode), undefined)
  assert.equal(confirmQuestion(new Error('nope')), undefined)
})

test('confirmable retries with confirm:true after the user accepts', async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 409, body: { error: 'confirm-required', data: { question: 'Update "a"?' } } },
    { status: 202, body: { data: { jobId: 'j' } } },
  ])
  const api = createApi(fetchFn)
  const asked: string[] = []
  const env = await confirmable(
    (confirm) => api.update('a', confirm),
    async (question) => {
      asked.push(question)
      return true
    },
  )
  assert.deepEqual(asked, ['Update "a"?'])
  assert.deepEqual(env?.data, { jobId: 'j' })
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { name: 'a', confirm: false })
  assert.deepEqual(JSON.parse(calls[1]!.init?.body as string), { name: 'a', confirm: true })
})

test('confirmable resolves undefined when the user declines', async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 409, body: { error: 'confirm-required', data: { question: 'Remove "a"?' } } },
  ])
  const api = createApi(fetchFn)
  const result = await confirmable(
    (confirm) => api.remove('a', confirm),
    async () => false,
  )
  assert.equal(result, undefined)
  assert.equal(calls.length, 1) // no retry happened
})

test('confirmable propagates non-confirm errors untouched', async () => {
  const { fetchFn } = fakeFetch([{ status: 409, body: { error: 'busy', data: { name: 'a' } } }])
  const api = createApi(fetchFn)
  await assert.rejects(
    confirmable(
      (confirm) => api.update('a', confirm),
      async () => true,
    ),
    (err: unknown) => err instanceof ApiError && err.error === 'busy',
  )
})

test('jobConfirmationQuestion extracts the marker from job errors', () => {
  assert.equal(
    jobConfirmationQuestion(job('j', 'error', { error: 'confirmation required: Proceed?' })),
    'Proceed?',
  )
  assert.equal(
    jobConfirmationQuestion(job('j', 'error', { error: 'some other failure' })),
    undefined,
  )
  assert.equal(jobConfirmationQuestion(job('j', 'done')), undefined)
})

/* ------------------------------------------------------------------ */
/* Job polling (§7.5)                                                  */
/* ------------------------------------------------------------------ */

test('pollJob settles once the job leaves running and reports every tick', async () => {
  const { fetchFn } = fakeFetch([
    ok({ job: job('j', 'running', { stage: 'cloning' }) }, 'done'),
    ok({ job: job('j', 'running', { stage: 'linking' }) }, 'done'),
    ok({ job: job('j', 'done', { stage: 'linking', endedAt: 'later' }) }, 'done'),
  ])
  const ticks: string[] = []
  const settled = await pollJob(createApi(fetchFn), 'j', {
    sleep: async () => undefined,
    onTick: (j) => ticks.push(j.stage ?? '?'),
  })
  assert.equal(settled.status, 'done')
  assert.deepEqual(ticks, ['cloning', 'linking', 'linking'])
})

test('pollJob resolves cancelled jobs without throwing', async () => {
  const { fetchFn } = fakeFetch([ok({ job: job('j', 'cancelled') }, 'done')])
  const settled = await pollJob(createApi(fetchFn), 'j', { sleep: async () => undefined })
  assert.equal(settled.status, 'cancelled')
})

test('pollJob throws PollTimeoutError carrying the last running snapshot', async () => {
  const { fetchFn } = fakeFetch([ok({ job: job('j', 'running', { stage: 'pulling' }) }, 'done')])
  await assert.rejects(
    pollJob(createApi(fetchFn), 'j', {
      intervalMs: 10,
      maxWaitMs: 0,
      sleep: async () => undefined,
    }),
    (err: unknown) => {
      assert.ok(err instanceof PollTimeoutError)
      assert.equal(err.job.id, 'j')
      assert.equal(err.job.stage, 'pulling')
      return true
    },
  )
})

/* ------------------------------------------------------------------ */
/* List reconciliation (§11)                                           */
/* ------------------------------------------------------------------ */

const listEntry = (name: string, enabled = true): ListEntry => ({
  name,
  url: `github:owner/${name}`,
  ref: 'main',
  subdir: null,
  commit: null,
  hasGitSource: true,
  enabled,
  links: [],
  update: null,
})

test('reconcileList resolves when the first snapshot already satisfies the predicate', async () => {
  const { fetchFn, calls } = fakeFetch([ok({ entries: [listEntry('a')] }, 'done')])
  const entries = await reconcileList(createApi(fetchFn), (es) => es.some((e) => e.name === 'a'))
  assert.deepEqual(entries.map((e) => e.name), ['a'])
  assert.equal(calls.length, 1, 'no extra polls once the snapshot fits')
})

test('reconcileList polls until a snapshot satisfies the predicate', async () => {
  const { fetchFn, calls } = fakeFetch([
    ok({ entries: [listEntry('a')] }, 'done'),
    ok({ entries: [listEntry('a')] }, 'done'),
    ok({ entries: [listEntry('a'), listEntry('b')] }, 'done'),
  ])
  const ticks: string[][] = []
  const entries = await reconcileList(
    createApi(fetchFn),
    (es) => es.some((e) => e.name === 'b'),
    { sleep: async () => undefined, onTick: (es) => ticks.push(es.map((e) => e.name)) },
  )
  assert.deepEqual(entries.map((e) => e.name), ['a', 'b'])
  assert.deepEqual(ticks, [['a'], ['a']], 'every missed poll is reported')
  assert.equal(calls.length, 3)
})

test('reconcileList throws ReconcileTimeoutError carrying the last snapshot', async () => {
  const { fetchFn } = fakeFetch([ok({ entries: [listEntry('a')] }, 'done')])
  await assert.rejects(
    reconcileList(createApi(fetchFn), (es) => es.some((e) => e.name === 'b'), {
      intervalMs: 10,
      timeoutMs: 0,
      sleep: async () => undefined,
    }),
    (err: unknown) => {
      assert.ok(err instanceof ReconcileTimeoutError)
      assert.deepEqual(err.entries.map((e) => e.name), ['a'])
      return true
    },
  )
})

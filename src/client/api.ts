/**
 * The typed client for the `/skills-nexus/*` routes (§10.1).
 *
 * One fetch wrapper per §7.1 dialect: success envelopes unwrap to
 * `{ data, hotReload }`; failures throw `ApiError` carrying the status, the
 * `error` code and the optional `data` payload. The destructive routes rely on
 * the server's `409 confirm-required` as the single source of the consequence
 * wording (§12.2) — `confirmable()` plays the ask-then-retry flow on top of it.
 *
 * The transport is injectable as a narrow structural type so the whole module
 * is unit-testable in Node without a server, and so the browser bundle keeps
 * its only platform dependency on `fetch` itself. Contract types are declared
 * here on purpose (client-side mirror of the server responses, not an import
 * across the bundler/node module-resolution split). The one exception is
 * `import-decision.js`: it is dependency-free by construction precisely so this
 * half can render the same §10.2 verdict wording the CLI prints.
 */

import type { ImportDecision } from '../import-decision.js'

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/** Response surface this client needs (a subset of the DOM `Response`). */
export interface ApiFetchResponse {
  readonly status: number
  json(): Promise<unknown>
}

export interface ApiFetchInit {
  readonly method?: string
  readonly headers?: Record<string, string>
  /**
   * `string` for the JSON routes; `Blob` for the package upload, which sends the
   * chosen `File`'s bytes as the raw body (the filename travels in
   * `x-nexus-filename`, see `importPreview` / `importPackage`).
   */
  readonly body?: string | Blob
}

/** Injectable transport — the real `fetch` satisfies this shape. */
export type ApiFetch = (input: string, init?: ApiFetchInit) => Promise<ApiFetchResponse>

export type HotReload = 'pending' | 'done' | 'unsupported'

/** One envelope-level failure: status + `{ error, data? }` (§7.1 约定 2/4). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly data?: unknown,
  ) {
    super(`${status} ${error}`)
    this.name = 'ApiError'
  }
}

export interface Envelope<T> {
  data: T
  hotReload?: HotReload
}

/* ------------------------------------------------------------------ */
/* Contract types (client-side mirror of the server responses)         */
/* ------------------------------------------------------------------ */

export interface ListLink {
  linkName: string
  skillName: string
  enabled: boolean
}

export interface UpdateStatus {
  hasUpdate: boolean
  latestCommit: string | null
  checkedAt: string
}

export interface ListEntry {
  name: string
  url: string
  ref: string
  subdir: string | null
  commit: string | null
  /**
   * True when the entry records a git source — the server's own
   * `hasGitSource` predicate, which decides whether `update` /
   * `switch-version` are accepted or answered `400 not-a-git-clone`.
   */
  hasGitSource: boolean
  enabled: boolean
  links: ListLink[]
  update: UpdateStatus | null
}

export interface DoctorReport {
  version: number
  checks: Array<{ id: string; status: string; detail?: string; issues: unknown[] }>
  summary: { errors: number; warnings: number; updates: number }
}

export type JobKind = 'add' | 'import' | 'adopt' | 'update' | 'switch-version'
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled'

/** §7.5 Job schema as `GET /job` serves it. */
export interface Job {
  id: string
  kind: JobKind
  name: string
  status: JobStatus
  stage?: string
  detail?: string
  output: string[]
  error?: string
  startedAt: string
  endedAt?: string
}

/* ------------------------------------------------------------------ */
/* API object                                                          */
/* ------------------------------------------------------------------ */

export interface AddBody {
  url: string
  /** Overrides the derived entry name; the panel's optional field. */
  name?: string
  ref?: string
  subdir?: string
  confirm?: boolean
}

export interface SwitchVersionBody {
  name: string
  ref: string
  refType?: 'branch' | 'tag' | 'commit'
  confirm?: boolean
}

export interface AdoptBody {
  name: string
  /** Required, never guessed (§6): the panel asks the user for it. */
  url: string
  ref?: string
  subdir?: string
  /** Re-source an entry that already has a git source. */
  force?: boolean
  /** Delete the pre-adopt backup instead of reporting where it was kept. */
  prune?: boolean
  confirm?: boolean
}

/**
 * The four verdicts of §10.2 as the client consumes them — a structural mirror
 * of the server's `ImportPlan` (like every other contract type here, so the
 * bundler/node module split is not crossed). The wording of a decision is
 * rendered by `describeDecision` from `../import-decision.js`, which both the
 * CLI and the panel import: pure, dependency-free, so it can be in this bundle.
 */
export interface ImportPlan {
  source: string
  format: 'zip' | 'directory'
  labelled: boolean
  manifestOnly: boolean
  entries: ImportPlanEntry[]
  skipped: Array<{ name: string; reason: string }>
  candidate?: string
  peel: number
  files: number
}

/** Result of the synchronous `POST /export` route (channel C). */
export interface ExportResult {
  out: string
  format: 'zip' | 'directory'
  entries: number
  files: number
  skipped: Array<{ name: string; reason: string }>
}

/** Body of `POST /export`: either name a set or export every managed entry. */
export interface ExportBody {
  names?: string[]
  all?: boolean
}

export interface ImportPlanEntry {
  name: string
  root: string
  subdir?: string
  skills: Array<{ name: string; root: string; links: string[] }>
  enabled: boolean
  decision: ImportDecision
  conflict: boolean
  files: number
}

/** Options of `POST /import`; the package travels beside them, as the body. */
export interface ImportBody {
  /** Preview only: answers the plan synchronously, touches no nexus state. */
  dryRun?: boolean
  /** The remaining options (with `dryRun: false`) require this. */
  confirm?: boolean
  /** Overrides the entry name (single-entry packages only). */
  name?: string
  /** Restricts a labelled package to one entry name. */
  subdir?: string
  each?: boolean
  /** Replace an already-registered entry (honoured only with `confirm`). */
  force?: boolean
  noRemote?: boolean
  noNetCheck?: boolean
}

export interface NexusApi {
  list(): Promise<Envelope<{ entries: ListEntry[] }>>
  doctor(): Promise<Envelope<DoctorReport>>
  add(body: AddBody): Promise<Envelope<{ jobId: string }>>
  importPreview(file: File, opts?: ImportBody): Promise<Envelope<{ plan: ImportPlan }>>
  importPackage(file: File, opts?: ImportBody): Promise<Envelope<{ jobId: string }>>
  adopt(body: AdoptBody): Promise<Envelope<{ jobId: string }>>
  remove(name: string, confirm?: boolean): Promise<Envelope<{ name: string; removed: boolean; links: string[] }>>
  update(name: string, confirm?: boolean): Promise<Envelope<{ jobId: string }>>
  checkUpdates(): Promise<Envelope<{ results: unknown }>>
  switchVersion(body: SwitchVersionBody): Promise<Envelope<{ jobId: string }>>
  toggle(name: string, enabled: boolean): Promise<Envelope<{ name: string; enabled: boolean; links: Array<{ linkName: string; enabled: boolean }> }>>
  job(id: string): Promise<Envelope<{ job: Job }>>
  cancelJob(id: string): Promise<Envelope<{ id: string; status: JobStatus }>>
  export(body: ExportBody): Promise<Envelope<ExportResult>>
}

async function request<T>(fetchImpl: ApiFetch, path: string, init?: ApiFetchInit): Promise<Envelope<T>> {
  const res = await fetchImpl(path, init)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ApiError(res.status, 'invalid-response')
  }
  if (res.status < 200 || res.status >= 300) {
    const env = body as { error?: unknown; data?: unknown } | null
    throw new ApiError(
      res.status,
      typeof env?.error === 'string' ? env.error : 'unknown-error',
      env?.data,
    )
  }
  const env = body as { data?: unknown; hotReload?: unknown } | null
  if (env === null || typeof env !== 'object' || !('data' in env)) {
    throw new ApiError(res.status, 'invalid-envelope')
  }
  return {
    data: env.data as T,
    hotReload: env.hotReload as HotReload | undefined,
  }
}

function postJson<T>(fetchImpl: ApiFetch, path: string, body: Record<string, unknown>): Promise<Envelope<T>> {
  return request<T>(fetchImpl, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The filename header of the raw-body package upload (routes.ts, §10.3). */
const FILENAME_HEADER = 'x-nexus-filename'

/**
 * `POST /import` with the chosen file as the raw body: the options ride in the
 * query string and the filename in a header, because the body is the package
 * itself. One helper serves both shapes — the synchronous `dryRun` preview and
 * the `202` job — so the two calls cannot drift in how they encode the upload.
 */
function postPackage<T>(
  fetchImpl: ApiFetch,
  file: File,
  opts: ImportBody,
): Promise<Envelope<T>> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined) continue
    query.set(key, String(value))
  }
  return request<T>(fetchImpl, `/skills-nexus/import?${query.toString()}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      [FILENAME_HEADER]: file.name,
    },
    body: file,
  })
}

/**
 * Build the api object over an injectable transport. The default binds the
 * global `fetch` (the browser half runs same-origin — paths only, no host).
 */
export function createApi(fetchImpl: ApiFetch = (input, init) => fetch(input, init)): NexusApi {
  return {
    list: () => request(fetchImpl, '/skills-nexus/list'),
    doctor: () => request(fetchImpl, '/skills-nexus/doctor'),
    add: (body) => postJson(fetchImpl, '/skills-nexus/add', body as unknown as Record<string, unknown>),
    importPreview: (file, opts = {}) =>
      postPackage(fetchImpl, file, { ...opts, dryRun: true, confirm: false }),
    importPackage: (file, opts = {}) =>
      postPackage(fetchImpl, file, { ...opts, dryRun: false, confirm: true }),
    adopt: (body) => postJson(fetchImpl, '/skills-nexus/adopt', body as unknown as Record<string, unknown>),
    remove: (name, confirm) => postJson(fetchImpl, '/skills-nexus/remove', { name, confirm: confirm === true }),
    update: (name, confirm) => postJson(fetchImpl, '/skills-nexus/update', { name, confirm: confirm === true }),
    checkUpdates: () => postJson(fetchImpl, '/skills-nexus/check-updates', {}),
    switchVersion: (body) => postJson(fetchImpl, '/skills-nexus/switch-version', body as unknown as Record<string, unknown>),
    toggle: (name, enabled) => postJson(fetchImpl, '/skills-nexus/toggle', { name, enabled }),
    job: (id) => request(fetchImpl, `/skills-nexus/job?id=${encodeURIComponent(id)}`),
    cancelJob: (id) => postJson(fetchImpl, '/skills-nexus/job/cancel', { id }),
    export: (body) => postJson(fetchImpl, '/skills-nexus/export', body as unknown as Record<string, unknown>),
  }
}

/* ------------------------------------------------------------------ */
/* Confirm-required retry (§7.1 约定 4 / §10.4)                        */
/* ------------------------------------------------------------------ */

const CONFIRM_REQUIRED = 'confirm-required'

/** True for the `409 confirm-required` dialect the destructive routes answer. */
export function isConfirmRequired(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.error === CONFIRM_REQUIRED
}

/** The `data.question` of a confirm-required error, when present. */
export function confirmQuestion(err: unknown): string | undefined {
  if (!isConfirmRequired(err)) return undefined
  const q = (err.data as { question?: unknown } | undefined)?.question
  return typeof q === 'string' && q.length > 0 ? q : undefined
}

/**
 * The ask-then-retry flow: run `fn(false)`; on a confirm-required answer show
 * the server's question through `ask`, and — only if the user accepts — run
 * `fn(true)`. Any other error propagates; a declined ask resolves `undefined`.
 */
export async function confirmable<T>(
  fn: (confirm: boolean) => Promise<T>,
  ask: (question: string) => Promise<boolean>,
): Promise<T | undefined> {
  try {
    return await fn(false)
  } catch (err) {
    const question = confirmQuestion(err)
    if (question === undefined) throw err
    if (!(await ask(question))) return undefined
    return await fn(true)
  }
}

/** The question inside an errored job (`NeedsConfirm` → job error, §7.5). */
export function jobConfirmationQuestion(job: Job): string | undefined {
  if (job.status !== 'error' || job.error === undefined) return undefined
  const marker = 'confirmation required: '
  return job.error.startsWith(marker) ? job.error.slice(marker.length) : undefined
}

/* ------------------------------------------------------------------ */
/* Job polling (§7.5)                                                  */
/* ------------------------------------------------------------------ */

/** `pollJob` gave up waiting — the job is still `running` past `maxWaitMs`. */
export class PollTimeoutError extends Error {
  constructor(readonly job: Job) {
    super(`job ${job.id} is still running`)
    this.name = 'PollTimeoutError'
  }
}

export interface PollOptions {
  /** Interval between polls (default 1000ms). */
  intervalMs?: number
  /** Give up polling after this long (default 10 minutes). */
  maxWaitMs?: number
  /** Injectable sleep — tests resolve immediately. */
  sleep?: (ms: number) => Promise<void>
  /** Called after every poll (running or not). */
  onTick?: (job: Job) => void
}

/**
 * Poll `GET /job?id=` until the job leaves `running`. Resolves the settled
 * job; throws `PollTimeoutError` (carrying the last snapshot) past the
 * deadline — the job itself keeps running server-side and can still be
 * cancelled or found by a later poll.
 */
export async function pollJob(api: NexusApi, id: string, opts: PollOptions = {}): Promise<Job> {
  const interval = opts.intervalMs ?? 1000
  const deadline = Date.now() + (opts.maxWaitMs ?? 10 * 60 * 1000)
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  for (;;) {
    const { data } = await api.job(id)
    opts.onTick?.(data.job)
    if (data.job.status !== 'running') return data.job
    if (Date.now() >= deadline) throw new PollTimeoutError(data.job)
    await sleep(interval)
  }
}

/* ------------------------------------------------------------------ */
/* List reconciliation (§11)                                           */
/* ------------------------------------------------------------------ */

/** `reconcileList` gave up before the list reflected the mutation. */
export class ReconcileTimeoutError extends Error {
  constructor(readonly entries: ListEntry[]) {
    super('the list did not reflect the change in time')
    this.name = 'ReconcileTimeoutError'
  }
}

export interface ReconcileOptions {
  /** Interval between polls (default 250ms). */
  intervalMs?: number
  /** Give up after this long (default 2000ms — the §11 budget). */
  timeoutMs?: number
  /** Injectable sleep — tests resolve immediately. */
  sleep?: (ms: number) => Promise<void>
  /** Called after every poll that did not yet satisfy `until`. */
  onTick?: (entries: ListEntry[]) => void
}

/**
 * §11 reconciliation for a `hotReload: 'pending'` mutation: poll `list` until
 * `until` accepts the snapshot — i.e. the link change the host watcher is
 * about to confirm is visible. Resolves the accepted snapshot; throws
 * `ReconcileTimeoutError` (carrying the last snapshot) past the deadline —
 * the caller downgrades to a manual-refresh hint.
 */
export async function reconcileList(
  api: NexusApi,
  until: (entries: ListEntry[]) => boolean,
  opts: ReconcileOptions = {},
): Promise<ListEntry[]> {
  const interval = opts.intervalMs ?? 250
  const deadline = Date.now() + (opts.timeoutMs ?? 2000)
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  for (;;) {
    const { data } = await api.list()
    if (until(data.entries)) return data.entries
    opts.onTick?.(data.entries)
    if (Date.now() >= deadline) throw new ReconcileTimeoutError(data.entries)
    await sleep(interval)
  }
}

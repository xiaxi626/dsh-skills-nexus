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
 * across the bundler/node module-resolution split).
 */

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
  readonly body?: string | FormData
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
  source: string
  enabled: boolean
  links: ListLink[]
  update: UpdateStatus | null
}

export interface DoctorReport {
  version: number
  checks: Array<{ id: string; status: string; detail?: string; issues: unknown[] }>
  summary: { errors: number; warnings: number; updates: number }
}

export type JobKind = 'add' | 'add-zip' | 'update' | 'switch-version'
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

export interface NexusApi {
  list(): Promise<Envelope<{ entries: ListEntry[] }>>
  doctor(): Promise<Envelope<DoctorReport>>
  add(body: AddBody): Promise<Envelope<{ jobId: string }>>
  addZip(file: File): Promise<Envelope<{ jobId: string }>>
  remove(name: string, confirm?: boolean): Promise<Envelope<{ name: string; removed: boolean; links: string[] }>>
  update(name: string, confirm?: boolean): Promise<Envelope<{ jobId: string }>>
  checkUpdates(): Promise<Envelope<{ results: unknown }>>
  switchVersion(body: SwitchVersionBody): Promise<Envelope<{ jobId: string }>>
  toggle(name: string, enabled: boolean): Promise<Envelope<{ name: string; enabled: boolean; links: Array<{ linkName: string; enabled: boolean }> }>>
  job(id: string): Promise<Envelope<{ job: Job }>>
  cancelJob(id: string): Promise<Envelope<{ id: string; status: JobStatus }>>
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

/**
 * Build the api object over an injectable transport. The default binds the
 * global `fetch` (the browser half runs same-origin — paths only, no host).
 */
export function createApi(fetchImpl: ApiFetch = (input, init) => fetch(input, init)): NexusApi {
  return {
    list: () => request(fetchImpl, '/skills-nexus/list'),
    doctor: () => request(fetchImpl, '/skills-nexus/doctor'),
    add: (body) => postJson(fetchImpl, '/skills-nexus/add', body as unknown as Record<string, unknown>),
    addZip: (file) => {
      const form = new FormData()
      form.append('file', file)
      return request(fetchImpl, '/skills-nexus/add-zip', { method: 'POST', body: form })
    },
    remove: (name, confirm) => postJson(fetchImpl, '/skills-nexus/remove', { name, confirm: confirm === true }),
    update: (name, confirm) => postJson(fetchImpl, '/skills-nexus/update', { name, confirm: confirm === true }),
    checkUpdates: () => postJson(fetchImpl, '/skills-nexus/check-updates', {}),
    switchVersion: (body) => postJson(fetchImpl, '/skills-nexus/switch-version', body as unknown as Record<string, unknown>),
    toggle: (name, enabled) => postJson(fetchImpl, '/skills-nexus/toggle', { name, enabled }),
    job: (id) => request(fetchImpl, `/skills-nexus/job?id=${encodeURIComponent(id)}`),
    cancelJob: (id) => postJson(fetchImpl, '/skills-nexus/job/cancel', { id }),
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

/**
 * The Settings panel (§10.4): entry-granularity skill cards, an add form
 * (git url), the job progress view (§7.5) and the destructive-action confirm
 * flow (§12.2 — the server's `409 confirm-required` question is the single
 * source of consequence wording; the panel only asks and retries).
 *
 * The zip upload row is gone with `add-zip` (design §8 phase 3): zip is no
 * longer an installation method, and the package channel (`import`) has not
 * reached the panel yet (§10.3). That row is where it will live.
 *
 * Styling stays deliberately structural (semantic elements, no stylesheet
 * dependency): the half runs inside the host Settings shell, and hooking the
 * host UI primitives is a later refinement — the contract proven here is the
 * data flow, not the pixels.
 *
 * §11 reconciliation is live: a mutation marked `hotReload: 'pending'` polls
 * the list (2s budget) until the change is visible; `done` refreshes once;
 * `unsupported` — the preserved contract for watcher-less hosts — explains
 * the restart downgrade. `reconcileAfter` is the single funnel for all three.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ChangeEvent, FormEvent } from 'react'
import {
  ApiError,
  PollTimeoutError,
  ReconcileTimeoutError,
  confirmable,
  createApi,
  jobConfirmationQuestion,
  pollJob,
  reconcileList,
} from './api.js'
import type { HotReload, Job, ListEntry, NexusApi } from './api.js'

/** One tracked job: the polled record plus the entry name it belongs to. */
interface TrackedJob {
  job: Job
  /** Entry the operation targets — labels the card while stage is generic. */
  entryName: string
  /** Set when polling gave up; the job may still be running server-side. */
  stalled?: boolean
}

const shortSha = (sha: string | null): string => (sha === null ? '' : sha.slice(0, 7))

/** Map route errors to one-line user-readable text (codes are the §7.1 contract). */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.error) {
      case 'busy': {
        const name = (err.data as { name?: string } | undefined)?.name
        return `"${name ?? 'skill'}" has another operation in flight — try again shortly`
      }
      case 'locked': {
        const lock = err.data as { pid?: number } | undefined
        return `locked by another process (pid ${lock?.pid ?? '?'}), likely a CLI command — retry once it exits`
      }
      case 'already-registered':
        return 'a skill with this name is already registered'
      case 'collision':
        return 'a file or directory with this name already exists in the skills root'
      case 'not-a-git-clone':
        return 'this entry has no git source — remove it and install it again from its repository'
      case 'ref-not-found':
        return 'the ref does not exist on the remote'
      case 'not-found':
        return 'no such skill — the list may be stale, refresh it'
      case 'untrusted origin':
        return 'request blocked: untrusted origin'
      default:
        return `${err.status} ${err.error}`
    }
  }
  return err instanceof Error ? err.message : String(err)
}

/* §11 reconciliation predicates — what each mutation should make visible in
 * `list` before the host watcher is presumed caught up. */

/** add: a name outside the pre-mutation baseline appears. */
function appearsNewName(baseline: Set<string>): (entries: ListEntry[]) => boolean {
  return (entries) => entries.some((e) => !baseline.has(e.name))
}

/** remove: the entry disappears from the list. */
function goneFrom(name: string): (entries: ListEntry[]) => boolean {
  return (entries) => !entries.some((e) => e.name === name)
}

/** toggle: the entry's enabled flag reaches `target`. */
function flipsTo(name: string, target: boolean): (entries: ListEntry[]) => boolean {
  return (entries) => entries.some((e) => e.name === name && e.enabled === target)
}

/**
 * update/switch-version: the entry survives the operation. A strict predicate
 * (commit changed) would falsely time out on no-op runs (already up to date),
 * so the sanity check is deliberately the weaker "still listed".
 */
function stillListed(name: string): (entries: ListEntry[]) => boolean {
  return (entries) => entries.some((e) => e.name === name)
}

/**
 * The panel. `api` is injectable for future harness tests; production builds
 * bind the global fetch. The instance MUST be render-stable: a per-render
 * `createApi()` default would change `refresh`'s identity every render,
 * re-fire the list effect, and loop the panel in a self-sustaining fetch
 * storm (observed live as connection-pool exhaustion in the host browser).
 * Lazy useState pins it for the mount's lifetime; the prop stays the
 * test-injection seam.
 */
export function NexusPanel({ api: apiProp }: { api?: NexusApi }): ReactElement {
  const [api] = useState<NexusApi>(() => apiProp ?? createApi())
  const [entries, setEntries] = useState<ListEntry[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [jobs, setJobs] = useState<TrackedJob[]>([])
  const [addUrl, setAddUrl] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [refInputs, setRefInputs] = useState<Record<string, string>>({})
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const env = await api.list()
      if (!alive.current) return
      setEntries(env.data.entries)
      setListError(null)
    } catch (err) {
      if (alive.current) setListError(errorText(err))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patchJob = useCallback((id: string, job: Job, stalled = false): void => {
    setJobs((prev) => {
      const next = prev.map((t) => (t.job.id === id ? { ...t, job, stalled } : t))
      return next.some((t) => t.job.id === id) ? next : [...next, { job, entryName: job.name }]
    })
  }, [])

  /**
   * §11 reconciliation funnel for a mutation. `pending` (or a missing field
   * from an older server): poll the list until `until` accepts a snapshot.
   * `done`: the mutation never woke the watcher — one refresh suffices.
   * `unsupported` (the preserved contract for hosts without a watcher): say
   * plainly that the change lands on the next host start. A timeout downgrades
   * to the manual-refresh hint while the last snapshot stays on screen.
   */
  const reconcileAfter = useCallback(
    async (
      label: string,
      hotReload: HotReload | undefined,
      until: (entries: ListEntry[]) => boolean,
    ): Promise<void> => {
      if (hotReload === 'done') {
        await refresh()
        return
      }
      if (hotReload === 'unsupported') {
        setNotice(
          `${label}: applied on disk — this host cannot hot-reload links, ` +
            'so it takes effect on the next host start',
        )
        await refresh()
        return
      }
      try {
        const entries = await reconcileList(api, until, {
          onTick: (snapshot) => {
            if (alive.current) setEntries(snapshot)
          },
        })
        if (!alive.current) return
        setEntries(entries)
        setListError(null)
      } catch (err) {
        if (!alive.current) return
        if (err instanceof ReconcileTimeoutError) {
          setEntries(err.entries)
          setListError(null)
          setNotice(`${label}: change not reflected yet — refresh manually shortly`)
          return
        }
        setNotice(errorText(err))
      }
    },
    [api, refresh],
  )

  /**
   * Track a 202-accepted job: poll to settlement, then reconcile the list.
   * `until` describes what the mutation should make visible (§11). Failed and
   * cancelled jobs only refresh — there is no change to reconcile.
   */
  const track = useCallback(
    async (
      entryName: string,
      accepted: { jobId: string },
      until: (entries: ListEntry[]) => boolean,
    ): Promise<void> => {
      try {
        const settled = await pollJob(api, accepted.jobId, {
          intervalMs: 800,
          onTick: (job) => patchJob(job.id, job),
        })
        if (!alive.current) return
        if (settled.status === 'error') {
          const question = jobConfirmationQuestion(settled)
          setNotice(
            question !== undefined
              ? `operation needs confirmation but the panel cannot confirm mid-job: ${question}`
              : `${entryName}: ${settled.error ?? 'operation failed'}`,
          )
          await refresh()
        } else if (settled.status === 'cancelled') {
          setNotice(`${entryName}: operation cancelled`)
          await refresh()
        } else {
          // The job did its link work; the watcher still has to catch up —
          // the same pending semantics as remove/toggle (§11).
          await reconcileAfter(entryName, 'pending', until)
        }
      } catch (err) {
        if (err instanceof PollTimeoutError) {
          patchJob(err.job.id, err.job, true)
          return
        }
        setNotice(errorText(err))
      }
    },
    [api, patchJob, reconcileAfter, refresh],
  )

  const run = useCallback(
    async (entryName: string, fn: () => Promise<void>): Promise<void> => {
      setNotice(null)
      try {
        await fn()
      } catch (err) {
        setNotice(errorText(err))
      }
    },
    [],
  )

  const ask = useCallback(async (question: string): Promise<boolean> => {
    return window.confirm(question)
  }, [])

  /* ---------------- actions ---------------- */

  const onAdd = (ev: FormEvent): void => {
    ev.preventDefault()
    const url = addUrl.trim()
    if (url.length === 0) return
    void run(url, async () => {
      setAddBusy(true)
      try {
        const baseline = new Set(entries.map((e) => e.name))
        const env = await api.add({ url, confirm: true })
        setAddUrl('')
        await track(url, env.data, appearsNewName(baseline))
      } finally {
        setAddBusy(false)
      }
    })
  }

  const onCheckUpdates = (): void => {
    void run('check-updates', async () => {
      setChecking(true)
      try {
        await api.checkUpdates()
        await refresh()
      } finally {
        setChecking(false)
      }
    })
  }

  const onToggle = (entry: ListEntry): void => {
    const target = !entry.enabled
    void run(entry.name, async () => {
      const env = await api.toggle(entry.name, target)
      await reconcileAfter(entry.name, env.hotReload, flipsTo(entry.name, target))
    })
  }

  const onUpdate = (entry: ListEntry): void => {
    void run(entry.name, async () => {
      const env = await confirmable(
        async (confirm) => {
          const accepted = await api.update(entry.name, confirm)
          await track(entry.name, accepted.data, stillListed(entry.name))
          return accepted
        },
        ask,
      )
      if (env === undefined) return // declined — nothing was requested
    })
  }

  const onRemove = (entry: ListEntry): void => {
    void run(entry.name, async () => {
      const done = await confirmable(
        (confirm) => api.remove(entry.name, confirm),
        ask,
      )
      if (done === undefined) return // declined — nothing was requested
      await reconcileAfter(entry.name, done.hotReload, goneFrom(entry.name))
    })
  }

  const onSwitchVersion = (entry: ListEntry): void => {
    const ref = (refInputs[entry.name] ?? '').trim()
    if (ref.length === 0) {
      setNotice(`enter a branch, tag or commit for "${entry.name}" first`)
      return
    }
    void run(entry.name, async () => {
      const env = await confirmable(
        async (confirm) => {
          const accepted = await api.switchVersion({ name: entry.name, ref, confirm })
          await track(entry.name, accepted.data, stillListed(entry.name))
          return accepted
        },
        ask,
      )
      if (env !== undefined) setRefInputs((prev) => ({ ...prev, [entry.name]: '' }))
    })
  }

  const onCancelJob = (job: Job): void => {
    void run(job.name, async () => {
      await api.cancelJob(job.id)
    })
  }

  const activeJobs = useMemo(
    () => jobs.filter((t) => t.job.status === 'running' || t.stalled),
    [jobs],
  )
  const settledJobs = useMemo(
    () => jobs.filter((t) => t.job.status !== 'running' && !t.stalled).slice(-3).reverse(),
    [jobs],
  )

  /* ---------------- render ---------------- */

  return (
    <div className="skills-nexus-panel">
      <p>
        Manage skill repositories: add by git url, toggle, update, pin versions.
        Discovery itself stays with the official provider — this panel only
        manages the clones and their symlinks.
      </p>

      {notice !== null && (
        <p role="status" className="skills-nexus-notice">
          {notice}
        </p>
      )}
      {listError !== null && (
        <p role="alert" className="skills-nexus-error">
          failed to load skills: {listError}
        </p>
      )}

      <JobProgress jobs={activeJobs} onCancel={onCancelJob} />

      <form onSubmit={onAdd}>
        <label>
          add from git url{' '}
          <input
            type="text"
            placeholder="github:owner/repo"
            value={addUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddUrl(e.target.value)}
            disabled={addBusy}
          />
        </label>
        <button type="submit" disabled={addBusy || addUrl.trim().length === 0}>
          add
        </button>
      </form>

      <div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'loading…' : 'refresh'}
        </button>
        <button type="button" onClick={onCheckUpdates} disabled={checking}>
          {checking ? 'checking…' : 'check updates'}
        </button>
      </div>

      {entries.length === 0 && !loading && listError === null && (
        <p>no skills registered yet — add one above.</p>
      )}

      <ul>
        {entries.map((entry) => (
          <li key={entry.name}>
            <EntryCard
              entry={entry}
              refValue={refInputs[entry.name] ?? ''}
              onRefChange={(v) => setRefInputs((prev) => ({ ...prev, [entry.name]: v }))}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onSwitchVersion={onSwitchVersion}
            />
          </li>
        ))}
      </ul>

      {settledJobs.length > 0 && (
        <details>
          <summary>recent operations</summary>
          <ul>
            {settledJobs.map((t) => (
              <li key={t.job.id}>
                {t.job.status === 'done' ? '✓' : t.job.status === 'cancelled' ? '–' : '✕'}{' '}
                {t.job.kind} · {t.entryName}
                {t.job.error !== undefined ? ` — ${t.job.error}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Entry card                                                          */
/* ------------------------------------------------------------------ */

interface EntryCardProps {
  entry: ListEntry
  refValue: string
  onRefChange: (value: string) => void
  onToggle: (entry: ListEntry) => void
  onUpdate: (entry: ListEntry) => void
  onRemove: (entry: ListEntry) => void
  onSwitchVersion: (entry: ListEntry) => void
}

function EntryCard({ entry, refValue, onRefChange, onToggle, onUpdate, onRemove, onSwitchVersion }: EntryCardProps): ReactElement {
  // Entries without a git source (snapshots, an imported package that had no
  // reachable remote) cannot be updated or switched — the server answers
  // `400 not-a-git-clone`, so the buttons are not offered at all.
  const canUpdate = entry.hasGitSource
  // Update badge only exists for branch-tracking entries (tag/commit pins and
  // source-less entries stay null, §7.2) — the runtime cache decides, no
  // refType here.
  const update = entry.update

  return (
    <article>
      <header>
        <strong>{entry.name}</strong>{' '}
        <small>
          {`${entry.url}${entry.subdir !== null ? ` · ${entry.subdir}` : ''}`}
        </small>{' '}
        {entry.enabled ? (
          <small>enabled</small>
        ) : (
          <small>disabled</small>
        )}
        {update !== null && update.hasUpdate && (
          <small>update available → {shortSha(update.latestCommit)}</small>
        )}
      </header>

      {entry.links.length > 0 && (
        <ul>
          {entry.links.map((l) => (
            <li key={l.linkName}>
              {l.enabled ? '✓' : '✕'} {l.linkName}
              {l.skillName !== l.linkName ? ` (${l.skillName})` : ''}
            </li>
          ))}
        </ul>
      )}

      <div>
        <button type="button" onClick={() => onToggle(entry)}>
          {entry.enabled ? 'disable' : 'enable'}
        </button>
        {canUpdate && (
          <>
            <button type="button" onClick={() => onUpdate(entry)}>
              update
            </button>
            <label>
              pin to{' '}
              <input
                type="text"
                placeholder="branch / tag / commit"
                value={refValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onRefChange(e.target.value)}
              />
            </label>
            <button type="button" onClick={() => onSwitchVersion(entry)} disabled={refValue.trim().length === 0}>
              switch
            </button>
          </>
        )}
        <button type="button" onClick={() => onRemove(entry)}>
          remove
        </button>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Job progress view (§7.5 / §10.4)                                    */
/* ------------------------------------------------------------------ */

function JobProgress({
  jobs,
  onCancel,
}: {
  jobs: TrackedJob[]
  onCancel: (job: Job) => void
}): ReactElement | null {
  if (jobs.length === 0) return null
  return (
    <section>
      <h4>running operations</h4>
      <ul>
        {jobs.map(({ job, entryName, stalled }) => (
          <li key={job.id}>
            <div>
              {entryName} · {job.kind}
              {job.stage !== undefined ? ` — ${job.stage}` : ''}
              {job.detail !== undefined ? ` (${job.detail})` : ''}
              {stalled ? ' — still running, polling gave up (check back later)' : ''}
            </div>
            {job.output.length > 0 && (
              <pre>{job.output.slice(-6).join('')}</pre>
            )}
            <button type="button" onClick={() => onCancel(job)} disabled={job.status !== 'running'}>
              cancel
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

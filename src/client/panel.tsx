/**
 * The Settings panel: entry-granularity skill rows, an add form (git url), the
 * package-import row, the job progress view and the destructive-action confirm
 * flow.
 *
 * The panel mirrors the command surface: an add form (git url, with the
 * optional name / ref / subdir channels), the **package import row** (pick a
 * file → synchronous `--dry-run` preview → confirm → `202` job), an **"attach
 * source" action on source-less entries only** (`adopt`), an **export all**
 * button, and the job progress view. The destructive-action confirm flow takes
 * its wording from the server: the `409 confirm-required` question is the single
 * source of consequence text, and the panel only asks and retries. The preview
 * renders the four verdicts of the import decision through `describeDecision`,
 * the same function the CLI's `--dry-run` uses.
 *
 * ## Presentation
 *
 * **Atoms come from the host, layout comes from CSS Modules, theme comes from
 * `--dsw-*` tokens.** That is the platform's own arrangement, not a choice made
 * here: the host's primitives are "Cordis-free React primitives styled only
 * through `--dsw-*` tokens", and the host's client build compiles
 * `x.module.css` into a hashed class map plus a self-injecting `<style>` tag.
 *
 * So `StateDot` / `Button` / `Tag` / `Switch` / `Input` / `DisclosureRow` /
 * `TerminalBlock` / `RiskConfirmation` arrive already themed and already
 * accessible, and `panel.module.css` only *positions* them: density, spacing
 * and the row rhythm. The design draft's fixed three-hex-accent styling system
 * is deliberately not implemented — it would need per-theme maintenance and
 * would not follow the shell.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is one of the nine specifiers the
 * browser loader's `require` can answer (see `PLATFORM_MODULES` in
 * `tsdown.config.ts`), so importing it here costs the bundle nothing and ships
 * no second copy.
 *
 * ## Reconciliation
 *
 * A mutation marked `hotReload: 'pending'` polls the list (2s budget) until the
 * change is visible; `done` refreshes once; `unsupported` — the preserved
 * contract for watcher-less hosts — explains the restart downgrade.
 * `reconcileAfter` is the single funnel for all three.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ChangeEvent, FormEvent } from 'react'
// The `React` *namespace* is a runtime requirement of the test runner, not a
// value this file reads: `tsconfig.json` sets no `jsx`, and tsx/esbuild therefore
// transpiles this component with the classic runtime — emitting
// `React.createElement` for `test/panel-render.test.tsx`. tsdown's own transform
// uses the automatic runtime and elides this import, so the shipped bundle is
// unchanged. (Verified: removing it makes all 13 of that file's render assertions
// fail with "React is not defined".)
//
// The disable directive below is reported as *unused*, which is the same
// blind spot from the other side: typescript-eslint does not model the runtime
// binding the classic transform needs, so it calls the import unused. The
// suppression stays because `--fix` would otherwise delete a load-bearing line.
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
import React from 'react'
import {
  Button,
  DisclosureRow,
  IconPinOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  RiskConfirmation,
  StateDot,
  Switch,
  Tag,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeDecision } from '../import-decision.js'
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
import type { DoctorReport, HotReload, ImportPlan, Job, ListEntry, NexusApi } from './api.js'
import css from './panel.module.css'

/** Reconciliation for `import`: every entry the plan promised shows up. */
function importedAll(plan: ImportPlan): (entries: ListEntry[]) => boolean {
  const wanted = plan.entries.map((e) => e.name)
  return (entries) => wanted.every((name) => entries.some((e) => e.name === name))
}

/** One tracked job: the polled record plus the entry name it belongs to. */
interface TrackedJob {
  job: Job
  /** Entry the operation targets — labels the card while stage is generic. */
  entryName: string
  /** Set when polling gave up; the job may still be running server-side. */
  stalled?: boolean
}

const shortSha = (sha: string | null): string => (sha === null ? '' : sha.slice(0, 7))

/** Map route errors to one-line user-readable text (codes are the route contract). */
export function errorText(err: unknown): string {
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
      case 'already-has-source':
        // The adopt button is only offered on source-less entries, so this is
        // the race / stale-list case; re-sourcing is CLI-only (`--force`).
        return 'this entry already has a git source — to re-source it, re-run from the CLI with --force'
      case 'skill-mismatch':
        // `--force` is deliberately not a panel control; the way out is the CLI.
        return 'the new source yields different skills than the snapshot — if that is intended, re-run from the CLI with --force'
      case 'ref-not-found':
        return 'the ref does not exist on the remote'
      case 'not-found':
        return 'no such skill — the list may be stale, refresh it'
      case 'untrusted origin':
        return 'request blocked: untrusted origin'
      case 'export-failed': {
        // The route carries the ExportError text in `data.message`; without it
        // the default branch would show a bare `400 export-failed`.
        const message = (err.data as { message?: string } | undefined)?.message
        return message ?? 'the export failed — refresh and try again'
      }
      default:
        return `${err.status} ${err.error}`
    }
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Lift the adopt backup path out of the settled job's output into a panel
 * notice. The route emits it as one output line (`previous directory kept as
 * <path>`); the wording below mirrors the CLI's own advice — delete it once
 * the new source looks right, doctor lists it until then.
 */
export function adoptBackupNotice(job: Job): string | null {
  for (const line of job.output) {
    const match = /previous directory kept as (.+?)\s*$/.exec(line)
    if (match !== null) {
      return `the previous directory is kept at ${match[1]} — delete it once the new source looks right (the CLI's doctor lists it until then)`
    }
  }
  return null
}

/** One entry's row state, as the status dot reports it. */
export function entryState(entry: ListEntry): StateDotState {
  if (!entry.hasGitSource) return 'idle'
  if (!entry.enabled) return 'idle'
  if (entry.update?.hasUpdate === true) return 'warning'
  return 'done'
}

/** The one-line health summary under the list. */
export function healthSummary(report: DoctorReport): {
  state: StateDotState
  text: string
} {
  const { errors, warnings, updates } = report.summary
  const parts = [`${errors} error(s)`, `${warnings} warning(s)`]
  if (updates > 0) parts.push(`${updates} update(s) available`)
  return {
    state: errors > 0 ? 'error' : warnings > 0 || updates > 0 ? 'warning' : 'done',
    text: parts.join(' · '),
  }
}

/* Reconciliation predicates — what each mutation should make visible in
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

/** Does the entry match the search box? Case-insensitive name / url / subdir. */
export function matchesQuery(entry: ListEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.url.toLowerCase().includes(q) ||
    (entry.subdir ?? '').toLowerCase().includes(q)
  )
}

/**
 * The panel. `api` is injectable for tests; production builds bind the global
 * fetch. The instance MUST be render-stable: a per-render `createApi()` default
 * would change `refresh`'s identity every render, re-fire the list effect, and
 * loop the panel in a self-sustaining fetch storm. Lazy useState pins it for
 * the mount's lifetime; the prop stays the injection seam.
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
  /** Collapsed optional add channels: name override / ref / subdir. */
  const [addOptionsOpen, setAddOptionsOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addRef, setAddRef] = useState('')
  const [addSubdir, setAddSubdir] = useState('')
  const [checking, setChecking] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [refInputs, setRefInputs] = useState<Record<string, string>>({})
  const [adoptInputs, setAdoptInputs] = useState<Record<string, string>>({})
  const [adoptSubdirInputs, setAdoptSubdirInputs] = useState<Record<string, string>>({})
  /** The chosen package file — kept so the confirmed run can re-send it. */
  const [importFile, setImportFile] = useState<File | null>(null)
  /** The synchronous `--dry-run` verdict, once previewed. */
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  /** Name/url filter over the rendered rows (client-side; touches no state). */
  const [query, setQuery] = useState('')
  /** The last `doctor` result, or null before the first check. */
  const [health, setHealth] = useState<DoctorReport | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  /**
   * The entry awaiting a destructive-action decision. `RiskConfirmation` is a
   * controlled overlay, so the question stays on screen until answered — the
   * one interaction `window.confirm` could not express.
   */
  const [pendingRemoval, setPendingRemoval] = useState<ListEntry | null>(null)
  const [removalAcknowledged, setRemovalAcknowledged] = useState(false)
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
   * Reconciliation funnel for a mutation. `pending` (or a missing field from an
   * older server): poll the list until `until` accepts a snapshot. `done`: the
   * mutation never woke the watcher — one refresh suffices. `unsupported` (the
   * preserved contract for hosts without a watcher): say plainly that the change
   * lands on the next host start. A timeout downgrades to the manual-refresh
   * hint while the last snapshot stays on screen.
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
   * `until` describes what the mutation should make visible. Failed and
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
          // the same pending semantics as remove/toggle.
          await reconcileAfter(entryName, 'pending', until)
          // An adopt that kept a backup says so only in its job output; lift
          // that path into a notice so it is not buried in one line. (Set
          // after reconcile so the backup message wins over a refresh hint.)
          const backup = adoptBackupNotice(settled)
          if (backup !== null && alive.current) setNotice(backup)
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

  /* ---------------- actions ---------------- */

  const onAdd = (ev: FormEvent): void => {
    ev.preventDefault()
    const url = addUrl.trim()
    if (url.length === 0) return
    const name = addName.trim()
    const ref = addRef.trim()
    const subdir = addSubdir.trim()
    void run(url, async () => {
      setAddBusy(true)
      try {
        const baseline = new Set(entries.map((e) => e.name))
        const env = await api.add({
          url,
          ...(name.length > 0 ? { name } : {}),
          ...(ref.length > 0 ? { ref } : {}),
          ...(subdir.length > 0 ? { subdir } : {}),
          confirm: true,
        })
        // Every input resets on success — a collapsed value left behind would
        // silently apply to the next add instead of this one.
        setAddUrl('')
        setAddName('')
        setAddRef('')
        setAddSubdir('')
        setAddOptionsOpen(false)
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

  /** The read-only `/doctor` route: errors, warnings and available updates. */
  const onDoctor = (): void => {
    void run('doctor', async () => {
      setHealthBusy(true)
      try {
        const env = await api.doctor()
        if (alive.current) setHealth(env.data)
      } finally {
        setHealthBusy(false)
      }
    })
  }

  /**
   * Export every managed entry to a zip on the server (channel C). The result
   * is a path, not a download — the notice below shows it as copyable text,
   * and `skipped[]` gets the same warning treatment as the CLI's stderr.
   */
  const onExport = (): void => {
    void run('export', async () => {
      setExportBusy(true)
      try {
        const env = await api.export({ all: true })
        const r = env.data
        const skipped = r.skipped.map((s) => `skipped "${s.name}": ${s.reason}`)
        const line =
          `exported ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}, ` +
          `${r.files} file${r.files === 1 ? '' : 's'} → ${r.out}`
        setNotice([line, ...skipped].join('\n'))
      } finally {
        setExportBusy(false)
      }
    })
  }

  /* ---------------- package import ---------------- */

  /** Picking a different file invalidates the verdict shown for the old one. */
  const onPickPackage = (ev: ChangeEvent<HTMLInputElement>): void => {
    setImportFile(ev.target.files?.[0] ?? null)
    setImportPlan(null)
  }

  /**
   * Step 1 — the synchronous preview. `dryRun` touches no nexus state, so it is
   * safe to run on every pick and gives the user the four-state verdict and the
   * candidate roots *before* anything is imported.
   */
  const onPreviewImport = (): void => {
    const file = importFile
    if (file === null) return
    void run('import', async () => {
      setImportBusy(true)
      try {
        const env = await api.importPreview(file)
        if (alive.current) setImportPlan(env.data.plan)
      } finally {
        setImportBusy(false)
      }
    })
  }

  /**
   * Step 2 — the confirmed run. The browser still holds the `File`, so the same
   * bytes are uploaded again rather than parking a server-side upload token;
   * the job then does the cloning and linking.
   */
  const onImport = (): void => {
    const file = importFile
    const plan = importPlan
    if (file === null || plan === null) return
    void run('import', async () => {
      setImportBusy(true)
      try {
        const env = await api.importPackage(file)
        setImportFile(null)
        setImportPlan(null)
        await track(`package ${file.name}`, env.data, importedAll(plan))
      } finally {
        setImportBusy(false)
      }
    })
  }

  const onAdopt = (entry: ListEntry): void => {
    const url = (adoptInputs[entry.name] ?? '').trim()
    if (url.length === 0) {
      setNotice(`enter the repository url for "${entry.name}" first — it is never guessed`)
      return
    }
    const subdir = (adoptSubdirInputs[entry.name] ?? '').trim()
    void run(entry.name, async () => {
      const env = await confirmable(
        async (confirm) => {
          const accepted = await api.adopt({
            name: entry.name,
            url,
            ...(subdir.length > 0 ? { subdir } : {}),
            confirm,
          })
          await track(entry.name, accepted.data, stillListed(entry.name))
          return accepted
        },
        ask,
      )
      if (env !== undefined) {
        setAdoptInputs((prev) => ({ ...prev, [entry.name]: '' }))
        setAdoptSubdirInputs((prev) => ({ ...prev, [entry.name]: '' }))
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

  /**
   * Ask, then remove. The question is the server's (`409 confirm-required`), so
   * the wording lives in one place; `RiskConfirmation` is only the surface that
   * asks it, with the server's text as its description.
   */
  const ask = useCallback(async (question: string): Promise<boolean> => {
    // Used by the confirmable() retry flow, which is entered for adopt / update
    // / switch-version. remove() takes the explicit overlay path below instead,
    // because that is the one destructive action with a place to put a
    // first-class confirmation.
    return window.confirm(question)
  }, [])

  /** Open the removal overlay; the server's question arrives on the retry. */
  const onRemove = (entry: ListEntry): void => {
    setPendingRemoval(entry)
    setRemovalAcknowledged(false)
  }

  /** The overlay's confirm: run the remove with the server's own question. */
  const onConfirmRemoval = (): void => {
    const entry = pendingRemoval
    if (entry === null) return
    setPendingRemoval(null)
    setRemovalAcknowledged(false)
    void run(entry.name, async () => {
      const done = await confirmable((confirm) => api.remove(entry.name, confirm), ask)
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
  /** Entries with an available update — the toolbar counter's source. */
  const updateCount = useMemo(
    () => entries.filter((e) => e.update?.hasUpdate === true).length,
    [entries],
  )
  const visibleEntries = useMemo(
    () => entries.filter((e) => matchesQuery(e, query)),
    [entries, query],
  )

  /* ---------------- render ---------------- */

  return (
    <div className={css.section}>
      <p className={css.lede}>
        Manage skill repositories: add by git url, toggle, update, pin versions.
        Discovery itself stays with the official provider — this panel only
        manages the clones and their symlinks.
      </p>

      {notice !== null && (
        <p role="status" className={css.notice}>
          {notice}
        </p>
      )}
      {listError !== null && (
        <p role="alert" className={css.error}>
          failed to load skills: {listError}
        </p>
      )}

      <JobProgress jobs={activeJobs} onCancel={onCancelJob} />

      {/* ---------------- install ---------------- */}
      <section className={css.install}>
        <h4 className={css.groupTitle}>install</h4>

        <form onSubmit={onAdd}>
          <div className={css.formRow}>
            <Input
              type="text"
              placeholder="github:owner/repo"
              value={addUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setAddUrl(e.target.value)}
              disabled={addBusy}
              aria-label="git url"
            />
            <Button type="submit" variant="primary" disabled={addBusy || addUrl.trim().length === 0}>
              add
            </Button>
          </div>

          <details
            className={css.optional}
            open={addOptionsOpen}
            onToggle={(e: ChangeEvent<HTMLDetailsElement>) => setAddOptionsOpen(e.currentTarget.open)}
          >
            <summary>optional: name / ref / subdir</summary>
            <div className={css.optionalGrid}>
              <label className={css.fieldLabel}>
                name
                <Input
                  type="text"
                  placeholder="entry name override (default: subdir leaf or repo slug)"
                  value={addName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddName(e.target.value)}
                  disabled={addBusy}
                />
              </label>
              <label className={css.fieldLabel}>
                ref
                <Input
                  type="text"
                  placeholder="branch/tag (a #ref in the url wins)"
                  value={addRef}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddRef(e.target.value)}
                  disabled={addBusy}
                />
              </label>
              <label className={css.fieldLabel}>
                subdir
                <Input
                  type="text"
                  placeholder="skills/foo (a repository-relative directory)"
                  value={addSubdir}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddSubdir(e.target.value)}
                  disabled={addBusy}
                />
              </label>
            </div>
          </details>

          <p className={css.hint}>
            supports github · gitee · gitlab · gitea · any git remote
          </p>
        </form>

        <div className={css.formRow}>
          <label className={css.fieldLabel}>
            import package
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={onPickPackage}
              disabled={importBusy}
            />
          </label>
          <Button
            type="button"
            onClick={onPreviewImport}
            disabled={importBusy || importFile === null}
          >
            preview
          </Button>
        </div>
        <p className={css.hint}>
          nexus package (.zip) produced by <code>export</code> — preview the plan, then confirm
        </p>
      </section>

      {importPlan !== null && (
        <div className={css.plan}>
          <p className={css.hint}>
            {`package: ${importPlan.source} (${importPlan.format}) · `}
            {importPlan.labelled
              ? `manifest: ${importPlan.entries.length} entry(ies)`
              : 'manifest: none (source unknown)'}
            {importPlan.peel > 0
              ? ` · peeled ${importPlan.peel} wrapper level(s), root: ${importPlan.candidate ?? '.'}`
              : ''}
          </p>
          <ul className={css.planList}>
            {importPlan.entries.map((planned) => (
              <li key={planned.name}>
                <strong>{planned.name}</strong>{' '}
                {`${planned.files} file(s), ${planned.skills.length} skill(s) — `}
                {describeDecision(planned)}
                {planned.conflict ? ' [already registered]' : ''}
                {planned.enabled ? '' : ' [disabled upstream]'}
              </li>
            ))}
          </ul>
          {importPlan.skipped.map((s) => (
            <p className={css.error} key={s.name}>
              {`skipped by the exporting machine: "${s.name}" — ${s.reason}`}
            </p>
          ))}
          {importPlan.manifestOnly && (
            <p className={css.error}>this package lists sources but carries no skill content</p>
          )}
          <div className={css.entryActions}>
            <Button type="button" variant="primary" onClick={onImport} disabled={importBusy}>
              import
            </Button>
          </div>
        </div>
      )}

      {/* ---------------- toolbar ---------------- */}
      <div className={css.toolbar}>
        <span className={css.search}>
          <Input
            type="search"
            icon={<IconSearchOutlineRegular />}
            placeholder="filter by name or url…"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            aria-label="filter skills"
          />
        </span>
        <Button
          type="button"
          icon={<IconRefreshOutlineRegular />}
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'loading…' : 'refresh'}
        </Button>
        <Button type="button" onClick={onCheckUpdates} disabled={checking}>
          {checking ? 'checking…' : 'check updates'}
        </Button>
        <Button type="button" onClick={onExport} disabled={exportBusy}>
          {exportBusy ? 'exporting…' : 'export all'}
        </Button>
        <span className={css.toolbarSpacer} />
        {updateCount > 0 && (
          <Tag tone="warning">{`${updateCount} update${updateCount === 1 ? '' : 's'}`}</Tag>
        )}
        <Tag tone="neutral">{`${entries.length} skill${entries.length === 1 ? '' : 's'}`}</Tag>
      </div>

      {entries.length === 0 && !loading && listError === null && (
        <p className={css.empty}>no skills registered yet — add one above.</p>
      )}
      {entries.length > 0 && visibleEntries.length === 0 && (
        <p className={css.empty}>{`no skill matches "${query.trim()}".`}</p>
      )}

      <ul className={css.entries}>
        {visibleEntries.map((entry) => (
          <li key={entry.name}>
            <EntryCard
              entry={entry}
              refValue={refInputs[entry.name] ?? ''}
              onRefChange={(v) => setRefInputs((prev) => ({ ...prev, [entry.name]: v }))}
              adoptValue={adoptInputs[entry.name] ?? ''}
              onAdoptChange={(v) => setAdoptInputs((prev) => ({ ...prev, [entry.name]: v }))}
              adoptSubdirValue={adoptSubdirInputs[entry.name] ?? ''}
              onAdoptSubdirChange={(v) =>
                setAdoptSubdirInputs((prev) => ({ ...prev, [entry.name]: v }))
              }
              onToggle={onToggle}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onSwitchVersion={onSwitchVersion}
              onAdopt={onAdopt}
            />
          </li>
        ))}
      </ul>

      {settledJobs.length > 0 && (
        <section className={css.jobs}>
          <h4 className={css.groupTitle}>recent operations</h4>
          <ul className={css.history}>
            {settledJobs.map((t) => (
              <li key={t.job.id}>
                {t.job.kind} · {t.entryName} —{' '}
                {t.job.status === 'done' ? 'done' : t.job.status === 'cancelled' ? 'cancelled' : 'failed'}
                {t.job.error !== undefined ? ` (${t.job.error})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- health check ---------------- */}
      <section className={css.health}>
        <span className={css.groupTitle}>health check</span>
        {health === null ? (
          <span className={css.hint}>not run yet</span>
        ) : (
          <>
            <StateDot state={healthSummary(health).state} />
            <span>{healthSummary(health).text}</span>
          </>
        )}
        <span className={css.toolbarSpacer} />
        <Button type="button" size="sm" onClick={onDoctor} disabled={healthBusy}>
          {healthBusy ? 'checking…' : 'run check'}
        </Button>
      </section>

      <p className={css.footer}>
        This panel manages the skills Nexus installed. To see every local skill
        (including the ones other tools manage), use Skill Manager.
      </p>

      {/*
        The destructive-action overlay. Its description is the server's own
        `question` where one is already known — the route is the single source of
        consequence wording — and a local sentence otherwise, because the
        question only arrives with the `409` on the first attempt.
      */}
      <RiskConfirmation
        open={pendingRemoval !== null}
        title="remove skill"
        description={
          pendingRemoval === null
            ? ''
            : `Remove "${pendingRemoval.name}"? This deletes its symlinks, its clone under repos/, and its manifest entry. ` +
              'The confirm step asks again with the server’s own wording.'
        }
        acknowledgeLabel="I understand this deletes the clone"
        cancelLabel="cancel"
        closeLabel="close"
        confirmLabel="remove"
        acknowledged={removalAcknowledged}
        onAcknowledgedChange={setRemovalAcknowledged}
        onCancel={() => {
          setPendingRemoval(null)
          setRemovalAcknowledged(false)
        }}
        onConfirm={onConfirmRemoval}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Entry row                                                           */
/* ------------------------------------------------------------------ */

interface EntryCardProps {
  entry: ListEntry
  refValue: string
  onRefChange: (value: string) => void
  adoptValue: string
  onAdoptChange: (value: string) => void
  adoptSubdirValue: string
  onAdoptSubdirChange: (value: string) => void
  onToggle: (entry: ListEntry) => void
  onUpdate: (entry: ListEntry) => void
  onRemove: (entry: ListEntry) => void
  onSwitchVersion: (entry: ListEntry) => void
  onAdopt: (entry: ListEntry) => void
}

/**
 * One entry row. Exported for `test/panel-render.test.ts`: the row is where
 * `hasGitSource` decides which actions exist (update/switch vs attach source)
 * and where `ownership: 'external'` decides what the meta column says, and both
 * are pure props → markup, so they can be rendered and asserted without a DOM,
 * a click, or a mounted effect.
 *
 * The `pin` disclosure is local state: only one row is ever expanded, and
 * `DisclosureRow` keeps the header/chevron behaviour consistent with the host's
 * own panels.
 */
export function EntryCard({
  entry,
  refValue,
  onRefChange,
  adoptValue,
  onAdoptChange,
  adoptSubdirValue,
  onAdoptSubdirChange,
  onToggle,
  onUpdate,
  onRemove,
  onSwitchVersion,
  onAdopt,
}: EntryCardProps): ReactElement {
  // Entries without a git source (snapshots, an imported package that had no
  // reachable remote) cannot be updated or switched — the server answers
  // `400 not-a-git-clone`, so the buttons are not offered at all.
  const canUpdate = entry.hasGitSource
  // An `external` entry only links a directory the user owns: `remove` deletes
  // the links and the manifest entry but never that directory, and `adopt`
  // refuses it outright. Saying so is the difference between "no source" and
  // "not yours to change".
  const external = entry.ownership === 'external'
  const update = entry.update
  const [pinOpen, setPinOpen] = useState(false)

  const tags: Array<{ tone: TagTone; text: string }> = []
  if (external) tags.push({ tone: 'quiet', text: 'linked directory' })
  else if (!canUpdate) tags.push({ tone: 'quiet', text: 'no source' })
  if (!entry.enabled) tags.push({ tone: 'outline', text: 'disabled' })

  return (
    <article className={css.entryRow}>
      <div className={css.entryHead}>
        <StateDot state={entryState(entry)} />
        <span className={css.entryName}>{entry.name}</span>
        <small className={`${css.entryMeta} ${css.mono}`}>
          {`${entry.url} · ${entry.ref || '—'}${entry.commit !== null ? ` · ${shortSha(entry.commit)}` : ''}${entry.subdir !== null ? ` · ${entry.subdir}` : ''}`}
        </small>
        {tags.map((t) => (
          <Tag key={t.text} tone={t.tone}>
            {t.text}
          </Tag>
        ))}
        {update !== null && update.hasUpdate && (
          <span className={css.updateArrow}>
            <Tag tone="warning">{`update available → ${shortSha(update.latestCommit)}`}</Tag>
          </span>
        )}
      </div>

      {entry.links.length > 0 && (
        <ul className={css.links}>
          {entry.links.map((l) => (
            <li key={l.linkName} className={l.enabled ? undefined : css.linkOff}>
              {l.enabled ? '✓' : '✕'} {l.linkName}
              {l.skillName !== l.linkName ? ` (${l.skillName})` : ''}
            </li>
          ))}
        </ul>
      )}

      <div className={css.entryActions}>
        <Switch
          checked={entry.enabled}
          onChange={() => onToggle(entry)}
          label={entry.enabled ? `disable ${entry.name}` : `enable ${entry.name}`}
        />
        {canUpdate && (
          <Button
            type="button"
            size="sm"
            onClick={() => onUpdate(entry)}
            icon={update?.hasUpdate === true ? <IconWarningOutlineRegular /> : undefined}
          >
            update
          </Button>
        )}
        {/* "attach source" appears only where it applies — a snapshot has no
            history to update, and an external entry is not nexus's to re-source
            (the adopt core refuses it). The url is typed by the user; `adopt`
            never guesses it. */}
        {!canUpdate && !external && (
          <>
            <label className={css.fieldLabel}>
              attach source
              <Input
                type="text"
                placeholder="github:owner/repo"
                value={adoptValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onAdoptChange(e.target.value)}
              />
            </label>
            <label className={css.fieldLabel}>
              subdir
              <Input
                type="text"
                placeholder="optional, e.g. skills/foo"
                value={adoptSubdirValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onAdoptSubdirChange(e.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => onAdopt(entry)}
              disabled={adoptValue.trim().length === 0}
            >
              adopt
            </Button>
          </>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => onRemove(entry)}>
          remove
        </Button>
      </div>

      {canUpdate && (
        <DisclosureRow
          icon={<IconPinOutlineRegular />}
          title={pinOpen ? 'pin — close' : 'pin to another version'}
          open={pinOpen}
          expandable
          onToggle={() => setPinOpen((v) => !v)}
        >
          <div className={css.pinRow}>
            <span className={css.pinInput}>
              <Input
                type="text"
                placeholder="branch / tag / commit"
                value={refValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onRefChange(e.target.value)}
                aria-label={`pin ${entry.name} to a branch, tag or commit`}
              />
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => onSwitchVersion(entry)}
              disabled={refValue.trim().length === 0}
            >
              switch
            </Button>
            <Button type="button" size="sm" onClick={() => setPinOpen(false)}>
              cancel
            </Button>
          </div>
        </DisclosureRow>
      )}

      {external && (
        <small className={css.hint}>
          remove only deletes the link and the manifest entry — the directory it
          points at is yours and stays where it is.
        </small>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Job progress view                                                   */
/* ------------------------------------------------------------------ */

/** Labels the terminal surface needs; this panel ships English only. */
const TERMINAL_LABELS = {
  signal: (signal: string) => `signal ${signal}`,
  exitCode: (code: number) => `exit ${code}`,
  noExitCode: 'no exit code',
  running: 'running',
  failed: 'failed',
  done: 'done',
  copy: 'copy',
  copied: 'copied',
  noOutput: '(no output yet)',
  collapseAria: 'collapse output',
  collapse: 'collapse',
  expandAria: (hidden: number) => `expand ${hidden} more line(s)`,
  expand: (hidden: number) => `expand ${hidden} more line(s)`,
}

function JobProgress({
  jobs,
  onCancel,
}: {
  jobs: TrackedJob[]
  onCancel: (job: Job) => void
}): ReactElement | null {
  if (jobs.length === 0) return null
  return (
    <section className={css.jobs}>
      <h4 className={css.groupTitle}>running operations</h4>
      <ul className={css.entries}>
        {jobs.map(({ job, entryName, stalled }) => (
          <li key={job.id} className={css.entryRow}>
            <div className={css.jobHead}>
              <StateDot state={job.status === 'running' ? 'ongoing' : 'error'} />
              <span>
                {entryName} · {job.kind}
                {job.stage !== undefined ? ` — ${job.stage}` : ''}
                {job.detail !== undefined ? ` (${job.detail})` : ''}
                {stalled ? ' — still running, polling gave up (check back later)' : ''}
              </span>
            </div>
            {job.output.length > 0 && (
              <TerminalBlock
                command={`${job.kind} ${entryName}`}
                output={job.output.join('')}
                running={job.status === 'running'}
                maxLines={6}
                runStateDot={false}
                labels={TERMINAL_LABELS}
              />
            )}
            <div className={css.entryActions}>
              <Button
                type="button"
                size="sm"
                onClick={() => onCancel(job)}
                disabled={job.status !== 'running'}
              >
                cancel
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

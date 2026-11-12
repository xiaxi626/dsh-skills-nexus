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
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconLinkOutlineRegular,
  IconPinOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  RiskConfirmation,
  SegmentedTabs,
  StateDot,
  Switch,
  Tag,
  TerminalBlock,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeDecision } from '../import-decision.js'
import { matchesQuery } from '../filter.js'
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
import type {
  DoctorReport,
  GroupState,
  HotReload,
  ImportPlan,
  Job,
  LinkPlan,
  ListEntry,
  NexusApi,
  ProjectFolderSkill,
  ProjectFileEntry,
  ProjectSkillEntry,
  WorkspaceRow,
} from './api.js'
import css from './panel.module.css'

/** Reconciliation for `import`: every entry the plan promised shows up. */
function importedAll(plan: ImportPlan): (entries: ListEntry[]) => boolean {
  const wanted = plan.entries.map((e) => e.name)
  return (entries) => wanted.every((name) => entries.some((e) => e.name === name))
}

/** Reconciliation for `link`: every planned entry shows up in the list. */
function linkedAll(plan: LinkPlan): (entries: ListEntry[]) => boolean {
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

/** Does the entry match the search box? Delegated to the shared `filter.ts`. */
export { matchesQuery }

/**
 * 浏览器侧来源展示列表；不导入含 Node 文件系统依赖的 external.ts。
 * 前十九项与后端支持源一致，顺序即面板按钮顺序；Antigravity 是唯一的禁用占位——
 * 它的三个发行形态各有不同的 global 技能位置，契约未定，暂不纳管。
 */
const LINK_SOURCES = [
  { id: 'trae-cn',     label: 'Trae CN',      enabled: true  },
  { id: 'trae',        label: 'Trae',         enabled: true  },
  { id: 'qoder',       label: 'Qoder',        enabled: true  },
  { id: 'qoder-cn',    label: 'Qoder CN',     enabled: true  },
  { id: 'codebuddy',   label: 'CodeBuddy',    enabled: true  },
  { id: 'workbuddy',   label: 'WorkBuddy',    enabled: true  },
  { id: 'copilot',     label: 'Copilot',      enabled: true  },
  { id: 'claude-code', label: 'Claude Code',  enabled: true  },
  { id: 'pi',          label: 'Pi',           enabled: true  },
  { id: 'codex',       label: 'Codex',        enabled: true  },
  { id: 'cursor',      label: 'Cursor',       enabled: true  },
  { id: 'shared',      label: 'Shared',       enabled: true  },
  { id: 'opencode',    label: 'OpenCode',     enabled: true  },
  { id: 'gemini',      label: 'Gemini CLI',   enabled: true  },
  { id: 'zcode',       label: 'ZCode',        enabled: true  },
  { id: 'openclaw',    label: 'OpenClaw',     enabled: true  },
  { id: 'augment',     label: 'Augment Code', enabled: true  },
  { id: 'kimi-code',   label: 'Kimi Code',    enabled: true  },
  { id: 'windsurf',    label: 'Windsurf',     enabled: true  },
  { id: 'antigravity', label: 'Antigravity',  enabled: false },
] as const

/** 组头可见名：来源 id 命中 LINK_SOURCES 用展示 label；--group 自定义名回退原样。 */
function groupDisplayName(l1Name: string): string {
  return LINK_SOURCES.find((s) => s.id === l1Name)?.label ?? l1Name
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
  const [groupStates, setGroupStates] = useState<GroupState[]>([])
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
  // Intentionally sticky across successful imports: whole-machine migration
  // workflows import several packages in a row, all locked. Clearing it on
  // success would force the user to re-check for every file.
  const [importLocked, setImportLocked] = useState(false)
  /** Link channel state: preview plan and busy flag. */
  const [linkPlan, setLinkPlan] = useState<LinkPlan | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkSourceDir, setLinkSourceDir] = useState('')
  /** Collapsed link-sources disclosure. Default open — the only live action lives here. */
  const [linkOpen, setLinkOpen] = useState(true)
  /** Name/url filter over the rendered rows (client-side; touches no state). */
  const [query, setQuery] = useState('')
  /**
   * L1 groups whose member list the user has folded. View state only: it
   * changes what is on screen, never what the group contains, and it is not
   * persisted — a reload reopening every group is the expected behaviour.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
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
  /** The group awaiting a group-level remove decision. */
  const [pendingGroupRemoval, setPendingGroupRemoval] = useState<string | null>(null)
  const [groupRemovalAcknowledged, setGroupRemovalAcknowledged] = useState(false)
  /**
   * Project scope: the root is typed, never persisted. The panel has no
   * workspace service to read it from, and a stored value would silently point
   * at a different project after the user moves directories.
   */
  /**
   * Which scope the settings section shows. Global skills come from the
   * manifest; project skills are a filesystem scan, so the two are separate
   * datasets and get separate tabs instead of one stacked page.
   */
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [projectRoot, setProjectRoot] = useState('')
  const [folderSkills, setFolderSkills] = useState<ProjectFolderSkill[]>([])
  const [projectEntries, setProjectEntries] = useState<ProjectSkillEntry[]>([])
  const [projectError, setProjectError] = useState<string | null>(null)
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectLinkBusy, setProjectLinkBusy] = useState(false)
  /* -------------------------------------------------------------- */
  /* Host-registered workspace block — fully independent state       */
  /* from the manual project-folder block above (计划硬约束 §7.3).   */
  /* -------------------------------------------------------------- */
  const [workspaceAvailable, setWorkspaceAvailable] = useState<boolean | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [workspacePath, setWorkspacePath] = useState('')
  const [workspaceEntries, setWorkspaceEntries] = useState<ProjectFileEntry[]>([])
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  /** The project link awaiting a removal decision. */
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<ProjectSkillEntry | null>(null)
  const [projectRemovalAcknowledged, setProjectRemovalAcknowledged] = useState(false)
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
      setGroupStates(env.data.groupStates ?? [])
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
        const result = await reconcileList(api, until, {
          onTick: ({ entries: tickEntries, groupStates: tickGroups }) => {
            if (alive.current) {
              setEntries(tickEntries)
              setGroupStates(tickGroups)
            }
          },
        })
        if (!alive.current) return
        setEntries(result.entries)
        setGroupStates(result.groupStates)
        setListError(null)
      } catch (err) {
        if (!alive.current) return
        if (err instanceof ReconcileTimeoutError) {
          setEntries(err.entries)
          setGroupStates(err.groupStates)
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
        const env = await api.importPreview(file, { locked: importLocked })
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
        const env = await api.importPackage(file, { locked: importLocked })
        setImportFile(null)
        setImportPlan(null)
        // importLocked is intentionally NOT cleared here — see declaration.
        await track(`package ${file.name}`, env.data, importedAll(plan))
      } finally {
        setImportBusy(false)
      }
    })
  }

  /* ---------------- 本地来源技能 ---------------- */

  /** 预览所选来源；切换来源先丢弃旧计划，失败时也不能执行旧计划。 */
  const onPreviewLink = (source: string): void => {
    setLinkPlan(null)
    void run('link', async () => {
      setLinkBusy(true)
      try {
        const sourceDir = linkSourceDir.trim()
        const env = await api.linkPreview(source, sourceDir ? { sourceDir } : {})
        if (alive.current) setLinkPlan(env.data.plan)
      } finally {
        setLinkBusy(false)
      }
    })
  }

  /** 使用预览的来源与路径执行，不回退到任何默认来源。 */
  const onLink = (source: string): void => {
    if (linkPlan === null || linkPlan.source !== source) return
    const plan = linkPlan
    void run('link', async () => {
      setLinkBusy(true)
      try {
        const sourceDir = linkSourceDir.trim()
        const env = await api.linkLocal(source, sourceDir ? { sourceDir } : {})
        setLinkPlan(null)
        await track(`link ${source}`, env.data, linkedAll(plan))
      } finally {
        setLinkBusy(false)
      }
    })
  }

  /* ---------------- project skills (filesystem, no manifest) ---------------- */

  /**
   * Refresh the project list. An empty root is not an error and never reaches
   * the server: this panel has no workspace service to infer one from, so the
   * user supplies the absolute path (and it is deliberately not persisted).
   */
  const refreshProject = useCallback(async (): Promise<void> => {
    const root = projectRoot.trim()
    if (root.length === 0) {
      setFolderSkills([])
      setProjectEntries([])
      setProjectError(null)
      return
    }
    setProjectBusy(true)
    try {
      const env = await api.projectList(root)
      if (!alive.current) return
      // Defensive against a host still serving the pre-viewer report while the
      // client bundle has already hot-reloaded.
      setFolderSkills(env.data.folderSkills ?? [])
      setProjectEntries(env.data.entries)
      setProjectError(null)
    } catch (err) {
      if (alive.current) setProjectError(errorText(err))
    } finally {
      if (alive.current) setProjectBusy(false)
    }
  }, [api, projectRoot])

  /** Load host-registered workspaces — called explicitly via the button (§7.3). */
  const loadWorkspaces = useCallback(async (): Promise<void> => {
    setWorkspaceBusy(true)
    try {
      const env = await api.workspacesList()
      if (!alive.current) return
      setWorkspaceAvailable(env.data.available)
      setWorkspaces(env.data.items)
      setWorkspaceError(null)
    } catch (err) {
      if (alive.current) {
        setWorkspaceError(errorText(err))
        setWorkspaceAvailable(false)
      }
    } finally {
      if (alive.current) setWorkspaceBusy(false)
    }
  }, [api])

  /** Refresh real-file entries for the **chosen registered workspace path**. */
  const refreshWorkspace = useCallback(async (path: string): Promise<void> => {
    setWorkspaceBusy(true)
    try {
      const env = await api.workspaceSkills(path)
      if (!alive.current) return
      setWorkspacePath(path)
      setWorkspaceEntries(env.data.entries)
      setWorkspaceError(null)
    } catch (err) {
      if (alive.current) {
        setWorkspaceError(errorText(err))
        setWorkspaceEntries([])
      }
    } finally {
      if (alive.current) setWorkspaceBusy(false)
    }
  }, [api])

  /** Toggle one real entry via the host-authorised workspace route. */
  const toggleWorkspaceFile = useCallback(async (entry: ProjectFileEntry): Promise<void> => {
    setWorkspaceBusy(true)
    try {
      await api.workspaceToggle(workspacePath, entry.name, !entry.enabled)
      await refreshWorkspace(workspacePath)
    } catch (err) {
      if (alive.current) setWorkspaceError(errorText(err))
    } finally {
      if (alive.current) setWorkspaceBusy(false)
    }
  }, [api, refreshWorkspace, workspacePath])

  /** Track a project-link job, then re-read the project directory. */
  const trackProjectLink = useCallback(
    async (label: string, accepted: { jobId: string }): Promise<void> => {
      try {
        const settled = await pollJob(api, accepted.jobId, {
          intervalMs: 500,
          onTick: (job) => patchJob(job.id, job),
        })
        if (!alive.current) return
        if (settled.status === 'error') {
          setProjectError(`${label}: ${settled.error ?? 'operation failed'}`)
        } else if (settled.status === 'cancelled') {
          setProjectError(`${label}: operation cancelled`)
        } else {
          const summary = settled.output.find((line) => line.startsWith('Linked'))
          setNotice(summary?.trim() ?? `${label}: links created`)
        }
        await refreshProject()
      } catch (err) {
        if (err instanceof PollTimeoutError) {
          patchJob(err.job.id, err.job, true)
          return
        }
        setProjectError(errorText(err))
      }
    },
    [api, patchJob, refreshProject],
  )

  /**
   * Link one skill the project folder itself provides. The folder scan already
   * showed what would be created, so this confirms directly — no second input
   * whose value could disagree with the row the user clicked.
   */
  const onLinkFolderSkill = (skill: ProjectFolderSkill): void => {
    const root = projectRoot.trim()
    if (root.length === 0 || projectLinkBusy) return
    void run('project-link', async () => {
      setProjectLinkBusy(true)
      try {
        const env = await api.projectLink(root, skill.resourceBase, true)
        if ('jobId' in env.data) await trackProjectLink('project link', env.data)
      } finally {
        setProjectLinkBusy(false)
      }
    })
  }

  /** Enable/disable one project link by moving it out of the scanned root. */
  const onToggleProject = (entry: ProjectSkillEntry): void => {
    const root = projectRoot.trim()
    if (root === '' || projectBusy) return
    const next = !entry.enabled
    void run(entry.name, async () => {
      setProjectBusy(true)
      try {
        await api.projectToggle(root, entry.name, next)
        setNotice(
          `project link "${entry.name}" ${next ? 'enabled' : 'disabled'} — target untouched`,
        )
        await refreshProject()
      } finally {
        setProjectBusy(false)
      }
    })
  }

  /** Open the project-link removal overlay (only link rows offer it). */
  const onRemoveProject = (entry: ProjectSkillEntry): void => {
    setPendingProjectRemoval(entry)
    setProjectRemovalAcknowledged(false)
  }

  /** The overlay's confirm: the server still requires `confirm: true`. */
  const onConfirmProjectRemoval = (): void => {
    const entry = pendingProjectRemoval
    if (entry === null) return
    setPendingProjectRemoval(null)
    setProjectRemovalAcknowledged(false)
    void run(entry.name, async () => {
      setProjectBusy(true)
      try {
        await api.projectRemove(projectRoot.trim(), entry.name, true)
        setNotice(`project link "${entry.name}" removed — its target directory is untouched`)
        await refreshProject()
      } finally {
        setProjectBusy(false)
      }
    })
  }

  /** Toggle every entry in a group by its path prefix (segment-exact). */
  const onToggleGroup = (groupPath: string, targetEnabled: boolean): void => {
    const prefix = groupPath.split('/')
    void run(`group ${groupPath}`, async () => {
      const env = await api.toggleGroup(groupPath, targetEnabled)
      // Reconcile: every entry in the group should reflect the target state.
      // Segment-exact, like the CLI: a joined-string `startsWith` would let
      // 'trae-cn/skill' reconcile 'trae-cn/skills/*' entries too.
      await reconcileAfter(`group ${groupPath}`, env.hotReload, (entries) =>
        entries
          .filter((e) => e.groupPath && prefix.every((seg, i) => e.groupPath![i] === seg))
          .every((e) => e.enabled === targetEnabled),
      )
    })
  }

  /** Fold or unfold one L1 group's member list. Touches no entry and no server. */
  const toggleGroupCollapsed = useCallback((l1Name: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(l1Name)) next.delete(l1Name)
      else next.add(l1Name)
      return next
    })
  }, [])

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

  /** Open the group removal overlay. */
  const onRemoveGroup = (groupPath: string): void => {
    setPendingGroupRemoval(groupPath)
    setGroupRemovalAcknowledged(false)
  }

  /** The overlay's confirm: run removeGroup with the server's question. */
  const onConfirmGroupRemoval = (): void => {
    const group = pendingGroupRemoval
    if (group === null) return
    setPendingGroupRemoval(null)
    setGroupRemovalAcknowledged(false)
    void run(`group ${group}`, async () => {
      const done = await confirmable(
        (confirm) => api.removeGroup(group, confirm),
        ask,
      )
      if (done === undefined) return
      await reconcileAfter(`group ${group}`, done.hotReload, (currentEntries) =>
        done.data.results.every((r) =>
          !currentEntries.some((e) => e.name === r.name)
        )
      )
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
  /** Entries separated into grouped (have groupPath) and ungrouped. */
  const { groupedEntries, ungroupedEntries } = useMemo(() => {
    const grouped: ListEntry[] = []
    const ungrouped: ListEntry[] = []
    for (const e of visibleEntries) {
      if (e.groupPath !== undefined && e.groupPath.length > 0) grouped.push(e)
      else ungrouped.push(e)
    }
    return { groupedEntries: grouped, ungroupedEntries: ungrouped }
  }, [visibleEntries])
  /** L1 groups derived from grouped entries: map from L1 name to entries. */
  const l1Groups = useMemo(() => {
    const map = new Map<string, ListEntry[]>()
    for (const e of groupedEntries) {
      const l1 = e.groupPath![0]!
      const existing = map.get(l1)
      if (existing !== undefined) existing.push(e)
      else map.set(l1, [e])
    }
    return map
  }, [groupedEntries])

  /** A filter is active: the visible set is already a subset, so folding a
   *  group would hide matches the user is looking for. Groups stay open. */
  const searching = query.trim().length > 0
  /** One rendered member row — the flat list and every group share this. */
  const renderEntry = (entry: ListEntry): ReactElement => (
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
  )

  /* ---------------- render ---------------- */

  return (
    <div className={css.section}>
      {/*
        Two scopes, two tabs: the global half is the manifest-driven lifecycle,
        the project half is a filesystem scan of one project's `.dsh/skills`.
        Panels are caller-owned, so both stay mounted and the inactive one is
        hidden — switching tabs keeps half-typed forms and job progress intact.
      */}
      <SegmentedTabs
        items={[
          {
            value: 'global',
            label: 'Global skills',
            id: 'nexus-tab-global',
            panelId: 'nexus-panel-global',
          },
          {
            value: 'project',
            label: 'Project skills',
            id: 'nexus-tab-project',
            panelId: 'nexus-panel-project',
          },
        ]}
        value={scope}
        onChange={setScope}
        label="skill scope"
        className={css.tabs}
      />

      {notice !== null && (
        <p role="status" className={css.notice}>
          {notice}
        </p>
      )}

      <JobProgress jobs={activeJobs} onCancel={onCancelJob} />

      <div
        id="nexus-panel-global"
        role="tabpanel"
        aria-labelledby="nexus-tab-global"
        hidden={scope !== 'global'}
        className={css.tabPanel}
      >
        <p className={css.lede}>
          Manage skill repositories: add by git url, toggle, update, pin versions.
          Discovery itself stays with the official provider — this panel only
          manages the clones and their symlinks.
        </p>

        {listError !== null && (
          <p role="alert" className={css.error}>
            failed to load skills: {listError}
          </p>
        )}

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
        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            checked={importLocked}
            onChange={(e) => {
              setImportLocked(e.target.checked)
              setImportPlan(null)
            }}
            disabled={importBusy}
          />
          restore exact recorded versions (locked)
        </label>
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

      {/* ---------------- link local skills (collapsible) ---------------- */}
      <DisclosureRow
        icon={<IconLinkOutlineRegular />}
        title="link local skills"
        open={linkOpen}
        expandable
        expandOnRowClick
        onToggle={() => setLinkOpen((v) => !v)}
        className={css.linkDisclosure}
        contentClassName={css.linkHeaderContent}
        contentLayoutClassName={css.linkHeaderInner}
        collapsedContent={
          <span className={css.linkHeaderHint}>
            discover and register skills from agents on this machine
          </span>
        }
        keepContentWhenOpen
      >
        <div className={css.linkBody}>
          <div className={css.sourceRow}>
            {LINK_SOURCES.map((src) =>
              src.enabled ? (
                <Button
                  key={src.id}
                  type="button"
                  icon={<IconLinkOutlineRegular />}
                  onClick={() => onPreviewLink(src.id)}
                  disabled={linkBusy}
                >
                  {src.label}
                </Button>
              ) : (
                <Tooltip key={src.id} label="support planned" side="bottom">
                  <span className={css.sourceTip}>
                    <Button
                      type="button"
                      disabled
                      aria-label={`${src.label} — support planned`}
                    >
                      {src.label}
                    </Button>
                  </span>
                </Tooltip>
              ),
            )}
          </div>
          <label className={css.fieldLabel}>
            source root (optional)
            <Input
              type="text"
              aria-label="link source directory"
              placeholder="e.g. C:\Users\you\.trae-cn or /home/you/.trae"
              value={linkSourceDir}
              disabled={linkBusy}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setLinkSourceDir(e.target.value)
                setLinkPlan(null)
              }}
            />
          </label>
          <p className={css.hint}>
            absolute path on the server; overrides the selected source's default root
          </p>
          {linkPlan !== null && (
            <div className={css.plan}>
              <p className={css.hint}>
                {`source: ${linkPlan.source} · ${linkPlan.entries.length} skill(s) found`}
                {linkPlan.conflicts.length > 0 ? ` · ${linkPlan.conflicts.length} conflict(s)` : ''}
              </p>
              <ul className={css.planList}>
                {linkPlan.entries.map((entry) => (
                  <li key={entry.name}>
                    <strong>{entry.name}</strong>{' '}
                    ({entry.groupPath.join('/')})
                    {entry.skillName ? ` — ${entry.skillName}` : ''}
                  </li>
                ))}
              </ul>
              {linkPlan.conflicts.map((name) => (
                <p className={css.error} key={name}>
                  {`conflict: "${name}" already exists (pass --force from CLI to overwrite)`}
                </p>
              ))}
              <div className={css.entryActions}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => onLink(linkPlan.source)}
                  disabled={linkBusy || linkPlan.entries.length === 0}
                >
                  link
                </Button>
              </div>
            </div>
          )}
        </div>
      </DisclosureRow>



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
        {/* Ungrouped entries rendered flat */}
        {ungroupedEntries.map((entry) => (
          <li key={entry.name}>{renderEntry(entry)}</li>
        ))}
        {/* Grouped entries rendered under L1 group headers */}
        {[...l1Groups.entries()].map(([l1Name, groupEntries]) => {
          const gs = groupStates.find((g) => g.path.length === 1 && g.path[0] === l1Name)
          const groupEnabled = gs?.state === 'on'
          return (
            <SourceGroup
              key={`group:${l1Name}`}
              l1Name={l1Name}
              entries={groupEntries}
              groupEnabled={groupEnabled}
              groupMixed={gs?.state === 'mixed'}
              collapsed={!searching && collapsedGroups.has(l1Name)}
              foldDisabled={searching}
              onToggleCollapsed={() => toggleGroupCollapsed(l1Name)}
              onToggleGroup={() => onToggleGroup(l1Name, !groupEnabled)}
              onRemoveGroup={() => onRemoveGroup(l1Name)}
              renderEntry={renderEntry}
            />
          )
        })}
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

      </div>

      <div
        id="nexus-panel-project"
        role="tabpanel"
        aria-labelledby="nexus-tab-project"
        hidden={scope !== 'project'}
        className={css.tabPanel}
      >
        <p className={css.lede}>
          Skills in a project folder and the links under its{' '}
          <code>.dsh/skills</code>. Read-only unless you link or remove a link:
          nexus never edits a skill file and never deletes user content.
        </p>

        {/* ============ Host-registered workspace block (独立 state) ============ */}
        <section>
          <h4 className={css.groupTitle}>registered workspace (.dsh)</h4>
          {workspaceAvailable === null ? (
            <p className={css.hint}>
              click <button type="button" className={css.linkLike} onClick={() => void loadWorkspaces()}>load workspaces</button>
              to query the host registry (only available on the DSH web profile)
            </p>
          ) : workspaceAvailable === false ? (
            <p className={css.hint}>
              workspace registry unavailable on this host —
              the manual project folder input below works instead
            </p>
          ) : (
            <>
              <div className={css.formRow}>
                <label className={css.fieldLabel}>
                  workspace
                  <select
                    aria-label="registered workspace"
                    value={workspacePath}
                    disabled={workspaceBusy}
                    onChange={(e) => {
                      const next = e.target.value
                      if (next.length === 0) {
                        setWorkspacePath('')
                        setWorkspaceEntries([])
                        return
                      }
                      void refreshWorkspace(next)
                    }}
                  >
                    <option value="">pick a registered workspace…</option>
                    {workspaces.map((w) => (
                      <option key={w.id || w.path} value={w.path}>
                        {w.title || w.path}
                        {w.exists ? '' : ' — missing'}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  icon={<IconRefreshOutlineRegular />}
                  onClick={() => void loadWorkspaces()}
                  disabled={workspaceBusy}
                >
                  {workspaceBusy ? '…' : 'load workspaces'}
                </Button>
              </div>
              {workspaceError !== null && (
                <p className={css.error}>{workspaceError}</p>
              )}
              {workspacePath.length === 0 ? (
                <p className={css.hint}>select a registered workspace to see its real .dsh entries</p>
              ) : workspaceEntries.length === 0 ? (
                <p className={css.empty}>no real directories under the project skills root.</p>
              ) : (
                <ul className={css.entries}>
                  {workspaceEntries.map((entry) => (
                    <li key={`${entry.name}:${entry.enabled}`} className={css.entryRow}>
                      <WorkspaceSkillRow
                        entry={entry}
                        busy={workspaceBusy}
                        onToggle={toggleWorkspaceFile}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <hr />

        {/* ============ Manual project-folder block (旧区块，逐字不变) ============ */}
        <div className={css.formRow}>
          <label className={css.fieldLabel}>
            project folder
            <Input
              type="text"
              aria-label="project root"
              placeholder="absolute path, e.g. D:\\theme-port-skill"
              value={projectRoot}
              disabled={projectBusy}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setProjectRoot(e.target.value)
                setFolderSkills([])
                setProjectEntries([])
                setProjectError(null)
              }}
            />
          </label>
          <Button
            type="button"
            icon={<IconRefreshOutlineRegular />}
            onClick={() => void refreshProject()}
            disabled={projectBusy || projectRoot.trim().length === 0}
          >
            {projectBusy ? 'loading…' : 'refresh'}
          </Button>
        </div>
        <p className={css.hint}>
          any absolute folder — it does not have to be a registered DSH workspace
        </p>

        {projectRoot.trim().length === 0 ? (
          <p className={css.hint}>enter a project folder to see its skills</p>
        ) : projectError !== null ? (
          <p className={css.error}>{projectError}</p>
        ) : (
          <>
            <section>
              <h4 className={css.groupTitle}>skills in this folder</h4>
              {folderSkills.length === 0 ? (
                <p className={css.empty}>no SKILL.md found in this folder itself.</p>
              ) : (
                <ul className={css.entries}>
                  {folderSkills.map((skill) => (
                    <li key={`${skill.resourceBase}:${skill.name}`} className={css.entryRow}>
                      <ProjectFolderSkillRow
                        skill={skill}
                        busy={projectLinkBusy}
                        onLink={onLinkFolderSkill}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className={css.groupTitle}>project skills root</h4>
              <p className={css.hint}>
                entries under <code>.dsh/skills</code> — links are managed; user
                files are shown read-only
              </p>
              {projectEntries.length === 0 ? (
                <p className={css.empty}>no entries in the project skills root yet.</p>
              ) : (
                <ul className={css.entries}>
                  {projectEntries.map((entry) => (
                    <li key={entry.name} className={css.entryRow}>
                      <ProjectSkillRow
                        entry={entry}
                        busy={projectBusy}
                        onToggle={onToggleProject}
                        onRemove={onRemoveProject}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

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
              "The confirm step asks again with the server's own wording."
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

      <RiskConfirmation
        open={pendingGroupRemoval !== null}
        title="remove skill group"
        description={
          pendingGroupRemoval === null
            ? ''
            : `Remove all ${entries.filter(
                (e) => e.groupPath?.[0] === pendingGroupRemoval
              ).length} skill(s) in "${pendingGroupRemoval}"? This deletes their symlinks, clones, and manifest entries.`
        }
        acknowledgeLabel="I understand this deletes the entire group"
        cancelLabel="cancel"
        closeLabel="close"
        confirmLabel="remove group"
        acknowledged={groupRemovalAcknowledged}
        onAcknowledgedChange={setGroupRemovalAcknowledged}
        onCancel={() => {
          setPendingGroupRemoval(null)
          setGroupRemovalAcknowledged(false)
        }}
        onConfirm={onConfirmGroupRemoval}
      />

      {/*
        Project-link removal. The consequence is deliberately narrow — only the
        link is removed and the target directory is never touched — so the
        acknowledgement says exactly that rather than borrowing the clone
        wording above.
      */}
      <RiskConfirmation
        open={pendingProjectRemoval !== null}
        title="remove project link"
        description={
          pendingProjectRemoval === null
            ? ''
            : `Remove "${pendingProjectRemoval.name}" from ${projectRoot.trim() || 'the project'}? ` +
              'Only the link is deleted; the directory it points at stays untouched.'
        }
        acknowledgeLabel="I understand this removes only the link"
        cancelLabel="cancel"
        closeLabel="close"
        confirmLabel="remove link"
        acknowledged={projectRemovalAcknowledged}
        onAcknowledgedChange={setProjectRemovalAcknowledged}
        onCancel={() => {
          setPendingProjectRemoval(null)
          setProjectRemovalAcknowledged(false)
        }}
        onConfirm={onConfirmProjectRemoval}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Entry row                                                           */
/* ------------------------------------------------------------------ */

interface WorkspaceSkillRowProps {
  entry: ProjectFileEntry
  busy: boolean
  onToggle: (entry: ProjectFileEntry) => void
}

/**
 * One real-file row for the workspace-authorised toggle. No remove (never
 * delete user content) and no dangling check (real directories don't dangle).
 * Toggle moves between `.dsh/skills` and `.dsh/skills-disabled`. Exported for
 * the static render test.
 */
export function WorkspaceSkillRow({
  entry,
  busy,
  onToggle,
}: WorkspaceSkillRowProps): ReactElement {
  const name = entry.skill?.name ?? entry.name
  const meta =
    entry.skill?.description?.trim() ||
    entry.skill?.error ||
    entry.path
  return (
    <div className={css.entryHead}>
      <span className={css.entryName}>{name}</span>
      <Tag tone="neutral">{entry.enabled ? 'active dir' : 'disabled dir'}</Tag>
      <span className={css.entryMeta}>{meta}</span>
      <span className={css.toolbarSpacer} />
      <Switch
        checked={entry.enabled}
        onChange={() => onToggle(entry)}
        label={entry.enabled ? `disable ${name}` : `enable ${name}`}
        disabled={busy}
      />
    </div>
  )
}

interface ProjectSkillRowProps {
  entry: ProjectSkillEntry
  busy: boolean
  onToggle: (entry: ProjectSkillEntry) => void
  onRemove: (entry: ProjectSkillEntry) => void
}

/**
 * One entry under `<project>/.dsh/skills`: the parsed skill name (falling back
 * to the filesystem name), a kind badge, the description/target, and a remove
 * action **only for links**.
 *
 * Exported for the static render test: "a user-files row has no remove action"
 * is the project scope's safety contract in the UI, and it is pure props →
 * markup — no request, no mounted effect.
 */
export function ProjectSkillRow({
  entry,
  busy,
  onToggle,
  onRemove,
}: ProjectSkillRowProps): ReactElement {
  const name = entry.skill?.name ?? entry.name
  const invalid = entry.kind === 'files' && entry.skill?.valid === false
  const disabled = entry.kind === 'link' && !entry.enabled
  const meta =
    [entry.skill?.description, entry.target].filter((part) => part).join(' · ') ||
    entry.skill?.error ||
    '—'
  return (
    <div className={css.entryHead}>
      <span className={css.entryName}>{name}</span>
      <Tag tone={entry.dangling || invalid ? 'warning' : 'neutral'}>
        {entry.kind === 'link'
          ? disabled
            ? 'disabled'
            : entry.dangling
              ? 'dangling'
              : 'link'
          : invalid
            ? 'invalid'
            : 'user files'}
      </Tag>
      <span className={css.entryMeta}>{meta}</span>
      <span className={css.toolbarSpacer} />
      {entry.kind === 'link' && (
        <>
          <Switch
            checked={entry.enabled}
            onChange={() => onToggle(entry)}
            label={entry.enabled ? `disable ${name}` : `enable ${name}`}
            disabled={busy}
          />
          <Button type="button" size="sm" onClick={() => onRemove(entry)} disabled={busy}>
            remove
          </Button>
        </>
      )}
    </div>
  )
}

interface ProjectFolderSkillRowProps {
  skill: ProjectFolderSkill
  busy: boolean
  onLink: (skill: ProjectFolderSkill) => void
}

/**
 * One skill the project **folder itself** provides. This is the source side:
 * the row can create a project link when the skill is valid and not linked
 * yet, and is otherwise read-only. Exported for the static render test.
 */
export function ProjectFolderSkillRow({
  skill,
  busy,
  onLink,
}: ProjectFolderSkillRowProps): ReactElement {
  const meta = skill.description || skill.error || '—'
  return (
    <div className={css.entryHead}>
      <span className={css.entryName}>{skill.name}</span>
      <Tag tone={skill.valid ? 'neutral' : 'warning'}>
        {skill.linked
          ? 'linked'
          : skill.disabled
            ? 'disabled'
            : skill.valid
              ? 'folder skill'
              : 'invalid'}
      </Tag>
      <span className={css.entryMeta}>{meta}</span>
      <span className={css.toolbarSpacer} />
      {!skill.linked && !skill.disabled && skill.valid && (
        <Button type="button" size="sm" onClick={() => onLink(skill)} disabled={busy}>
          link
        </Button>
      )}
    </div>
  )
}

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
/* The L1 group: header (fold + switch + remove) and its members       */
/* ------------------------------------------------------------------ */

interface SourceGroupProps {
  l1Name: string
  entries: ListEntry[]
  groupEnabled: boolean
  groupMixed: boolean
  collapsed: boolean
  /** 搜索框有内容时为 true：折叠按钮禁用（但组强制展开）。 */
  foldDisabled: boolean
  onToggleCollapsed: () => void
  onToggleGroup: () => void
  onRemoveGroup: () => void
  renderEntry: (entry: ListEntry) => ReactElement
}

/**
 * One L1 source group: its header and its members.
 *
 * Exported for `test/panel-render.test.ts` for the same reason `EntryCard` is:
 * header-plus-members is a pure props → markup mapping, so the three states
 * that matter (open, folded, folded-but-filtered) can be rendered and asserted
 * without a DOM or a click.
 *
 * Folding is a view state. The group switch and `remove group` stay in the
 * header whatever the members do, because both act on the whole group — a
 * folded group is still togglable and still removable, and a folded count
 * still reports the whole group; under an active filter the group is derived
 * from `visibleEntries`, so the count reports the matches instead.
 *
 * The name and the count are carried by the `.groupName` span, not by the
 * switch. The real primitives' `Switch` writes `label` into `aria-label` only
 * and never produces visible text, so leaning on it left the header showing no
 * group name at all — the test stub forwards `label` as an attribute, which
 * reads like proof of visibility but is not. The span is `aria-hidden` because
 * the switch already owns the accessible name; announcing both would read the
 * same group twice.
 */
export function SourceGroup({
  l1Name,
  entries,
  groupEnabled,
  groupMixed,
  collapsed,
  foldDisabled,
  onToggleCollapsed,
  onToggleGroup,
  onRemoveGroup,
  renderEntry,
}: SourceGroupProps): ReactElement {
  const count = entries.length
  return (
    <li>
      <div className={css.groupHeader}>
        <Tooltip
          label="clear the filter to fold this group"
          // An empty `label` still mounts the bubble (it only skips the text),
          // so the suppression channel is `disabled`, not a blank label.
          disabled={!foldDisabled}
          side="bottom"
        >
          <span className={css.groupFoldHit}>
            <button
              type="button"
              className={css.groupFold}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? 'expand' : 'collapse'} ${l1Name}`}
              disabled={foldDisabled}
              onClick={onToggleCollapsed}
            >
              {collapsed ? <IconChevronRightOutlineRegular /> : <IconChevronDownOutlineRegular />}
            </button>
          </span>
        </Tooltip>
        <span className={css.groupName} aria-hidden="true">{groupDisplayName(l1Name)} · {count}</span>
        <Switch
          checked={groupEnabled}
          onChange={onToggleGroup}
          label={`${groupMixed ? '◐' : groupEnabled ? '✓' : '○'} ${l1Name} (${count})`}
        />
        <Button type="button" size="sm" variant="outline" onClick={onRemoveGroup}>remove group</Button>
      </div>
      {!collapsed && <ul className={css.entries}>{entries.map((e) => <li key={e.name}>{renderEntry(e)}</li>)}</ul>}
    </li>
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

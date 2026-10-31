# Panel list-loading performance design

> [中文](perf-panel-list-loading.zh-CN.md) | **English**

Status: design boundaries for future implementation, not an implementation or
verification report. Step 4's P3 measurement has landed — see "Measurement log
and disposition" in Section 4 for the wall-clock and attribution numbers, and
the disposition column in Section 5 for each P3 candidate's verdict. P1, P2 and
P3 below name the scan, client and measurement phases defined in this document.

The goal is to reduce repeated filesystem work and avoid redundant panel list
requests without changing link attribution, list output or group-state semantics.
The architectural context is in [Architecture](ARCHITECTURE.md); contribution
conventions are in [CONTRIBUTING](../CONTRIBUTING.md). The requirements below are
self-contained and take precedence over any historical shorthand in source comments.

## 1. Bottleneck accounting

### Current read path

- `src/manifest.ts` reads the manifest once, then calls `entryLinks` for every
  entry. In `src/link.ts`, each call canonicalizes the entry base, reads the
  official skills root, and resolves and canonicalizes every candidate target.
- `src/http/routes.ts` decorates those links with a target `stat`, followed by
  `linkSkillName` → `previewSkills` for the frontmatter name. The normal root
  layout needs a `SKILL.md` locating `stat` and a `readFile`.
- `getUpdateStatus` in `src/update-cache.ts` is a pure in-memory lookup. It does
  not read files or contact git and is not a filesystem bottleneck.

Let \(N\) be the number of manifest entries and \(L\) the number of names in the
skills root. The following is an **application-level FS API-call estimate** for
an unchanged, normal successful fixture: every target has a root `SKILL.md`, each
link belongs to exactly one entry, and all path resolutions succeed on their
first attempt. These are not OS syscall counts or measured speedups.

| Boundary | Current full model | After P1 only | At \(N=10, L=50\) |
|---|---|---|---|
| T1: `listEntries` | \(1+2N+2NL\) | \(N+2+2L\) | 1021 → 112 |
| HTTP decoration beyond T1 | \(3L\) | \(3L\) | 150 → 150 |
| T2: full list route | \(1+2N+2NL+3L\) | \(N+2+5L\) | 1171 → 262 |

T1 currently counts one manifest read, one base resolution and one root read per
entry, and two resolution calls per entry/link pair. P1 would retain the manifest
read, canonicalize each base once, read the root once, and resolve/canonicalize
each link once. T2 additionally includes target existence and frontmatter work;
`deriveGroupStates` adds computation, not FS calls.

Dropping the fixed and \(N\)-level small terms gives the headline comparison:
\(2NL+3L=1150\) → \(5L=250\), about **78% fewer estimated FS API calls** after P1
alone. The full-model reduction is also approximately 78%; neither calculation
establishes a wall-clock improvement.

`safeRealPath` failure recovery can issue additional `realpath` calls while
walking ancestors, including retrying the failed path. Dangling links, multiple
ownership buckets and non-root discovery layouts change the count. P1 still
compares each resolved target with every base in memory: those comparisons remain
\(O(NL)\). Only the repeated FS scan is consolidated; the whole algorithm must not
be described as \(O(L)\).

## 2. P1 — consolidate the link scanner without changing attribution

### Interface and five equivalence rules

The scanner would live beside `entryLinks` in `src/link.ts`, not in a new module,
and share `pointsInto`, `safeRealPath` and `readLinkEntryTarget`:

```ts
export async function scanEntryLinks(entries: SkillEntry[]): Promise<Map<string, EntryLink[]>>
```

The map is keyed by entry management name, with an empty array for every supplied
entry that has no matches. The normal manifest uniqueness contract remains intact.

1. **One canonical base per entry.** Compute `entrySkillDir(entry)` and call
   `safeRealPath` once for each entry, using bounded concurrency. Keep the existing
   external-directory and managed-subdir rules, including legacy external entries;
   do not substitute a guessed clone path.
2. **One root enumeration.** Call `readdir(OFFICIAL_SKILLS_DIR)` once. Any failure,
   including a missing skills root, yields empty arrays for all supplied entries,
   just as the old per-entry scan does.
3. **One target read per root name.** Call `readLinkEntryTarget` once per name.
   Preserve its POSIX dangling-symlink `readlink` fallback; skip `undefined` without
   guessing ownership. Use a worker-pool limit of constant **8**, also bounding
   base preparation rather than launching all entries or links at once.
4. **One canonicalization per successful target, all matching buckets.** Call
   `safeRealPath` once for each recovered target and compare it with every base
   through `pointsInto`. Collect every match. One link may belong to both a parent
   entry and a nested subdir entry; first-match partitioning is forbidden.
5. **Original enumeration order and target representation.** Each bucket must
   retain the exact original `readdir` order, not worker-completion order and not
   a new sort order. Store indexed results and assemble in enumeration order.
   `EntryLink.target` remains the canonical string, preserving `list --json`.

These are attribution rules, not a new link-type filter. Do not exclude real
directories merely because they are not symlinks: the existing reader resolves
them and the existing base predicate decides their membership. A Windows dangling
junction whose target cannot be recovered remains unassigned; neither its name
nor an assumed clone relationship is proof of ownership. Removal and collision
safety must not be changed to make the scan faster.

### Integration boundary

- Make `entryLinks` a thin single-entry wrapper around `scanEntryLinks`. Keep
  toggle, remove, update and adopt callers unchanged; they retain their existing
  single-entry calls and write-path behavior.
- In `src/manifest.ts`, call the scanner once for the manifest entries, then
  assemble output in manifest order. Derive `enabled` from each bucket and keep
  `getUpdateStatus(entry.name) ?? null` at the output-assembly point.
- In `src/cli/commands/list.ts`, replace repeated `isEntryEnabled` calls in the
  default table with one scan of the selected entries. Preserve the independent
  `present` `stat`, filtering, columns and output order. Keep `--names` on its
  manifest-only, scan-free path, including existing empty/filter behavior.
- Keep the `list --json` schema, canonical targets, array order and framing
  unchanged. The HTTP route continues to decorate the shared listed view; P1 does
  not silently introduce the P3 decoration candidates.

### Differential test matrix

Add `test/link-scan.test.ts` during P1 and register it in the explicit `test`
script list in `package.json`; creating a test file alone does not enroll it.
The core oracle is the **pre-change per-entry implementation** retained as an
independent test reference. On the same unchanged fixture, use `deepStrictEqual`
for each old per-entry result against the corresponding new map bucket, including
order and target strings. Comparing the new wrapper to its own bulk scanner is
self-comparison and cannot establish equivalence.

| Fixture | Required evidence |
|---|---|
| Live managed, external and subdir targets | Same bases, names, canonical targets and enabled states |
| Dangling POSIX symlink | Recover the deleted target through `readlink`; retain attributable links |
| Dangling Windows junction | Preserve the reader's actual platform result; if unreadable, skip rather than invent ownership |
| Real directory in the skills root | Match the old predicate result; preserve collision and removal protection |
| Nested parent and subdir bases | The same link occurs in both matching buckets |
| Missing clone directory | Preserve ancestor normalization and any recoverable dangling-target attribution |
| Missing or unreadable skills root | Every entry receives an empty array |
| Ancestor rewritten by `realpath` | Reuse the directory-link fixture technique from `test/link-canonical.test.ts`, asserting that rewriting really occurs |
| Workers finish out of order | Buckets still follow original enumeration order; observed concurrency never exceeds 8 |

Set fixture home variables before importing the path-dependent module graph and
clean up temporary directories. Platform limitations must be explicit; a fixture
that cannot establish its precondition is not evidence of that case passing.

P1 requires both the differential suite and all four regression guardrails:
`test/link.test.ts`, `test/link-canonical.test.ts`, `test/list.test.ts` (including
unchanged JSON output), and `test/cli-plugin-parity.test.ts`. None may be omitted
from the acceptance evidence.

## 3. P2 — complete panel snapshots and earlier job polling

### Reconciliation contract

`src/client/api.ts` currently returns only entries from `reconcileList`; the panel
then makes an extra successful-tail `api.list()` request to repair group state.
The planned internal result would preserve both fields from the same list response:

```ts
type ReconcileResult = { entries: ListEntry[]; groupStates: GroupState[] }
```

Reuse the current list definitions of `ListEntry` and `GroupState`, rather than
creating a second shape with different field meanings.

- `reconcileList` would return `Promise<ReconcileResult>` and send the complete
  result to `onTick` on every unsatisfied poll, preserving callback timing.
- `ReconcileTimeoutError` would carry both `entries` and `groupStates` from the
  last response. Keep `until` as a predicate over entries only; do not strengthen
  mutation-completion semantics or change the existing reconciliation interval
  and timeout budget.
- In the panel's `reconcileAfter`, tick, success and timeout handling would update
  entries and group states together from the corresponding snapshot, with the
  existing mounted-state guards and notices. Preserve the existing empty-array
  fallback for absent group states when accommodating older responses.
- Remove the successful-tail `api.list()` only after full snapshots are wired
  through. `done` and `unsupported` still use `refresh`; the unsupported-host
  explanation remains. A missing hot-reload field still follows the pending path.

`reconcileList` and `ReconcileTimeoutError` are not re-exported through
`src/client/index.tsx`. This is a repository-internal API change, not a breaking
change to the package's public client entry point or its HTTP list response.

### Polling schedule

Keep the `pollJob` parameter surface unchanged. Its first request remains at
\(t_0\); if still running, successive sleeps become **200 ms, 400 ms, then
`intervalMs` steadily**. The panel's `track` currently supplies **800 ms**, while
the helper default is **1000 ms**. These are different steady-state values and
must not be conflated. Do not delay an already settled first response or alter
job cancellation, error or timeout semantics.

### Required evidence

- Update `test/client-api.test.ts` for the new return/callback signature, complete
  success and tick snapshots, and timeout snapshots with both fields. Queued
  responses must model group-state changes, not just entries.
- Exercise the panel's actual reconciliation orchestration with a counting mock
  API or an interaction harness. For a pending toggle requiring \(k\) list polls,
  assert exactly \(k\) mutation-related list calls, not \(k+1\); account separately
  for any initial mount refresh. Assert synchronized group states on tick, final
  success and timeout, plus unchanged `done`/`unsupported` refresh behavior.
- Keep `test/panel-render.test.tsx` as the static-render guard. Its SSR renderer
  runs no effects and cannot prove click handling, polling or request counts.
  Acceptance needs actual orchestration-mock or interaction evidence, not an SSR
  assertion relabelled as an interaction test. Retain `test/group-states.test.ts`
  for server-side group derivation semantics.
- Inject `sleep` to assert the long-job sequence 200/400/800/800… for the panel
  setting, and 200/400/1000/1000… for the helper default. Check immediate settlement
  and existing timeout/cancellation behavior as well.

## 4. P3 — measurements before decoration decisions

### Reproducible measurement boundaries

Use a temporary script that will not enter the repository history. Set both
`DSH_HOME` and `DSH_SKILLS_NEXUS_HOME` before dynamically importing application
modules: `src/paths.ts` captures them at import time. Switching variables after a
static import does not relocate an already loaded graph.

1. Create a disposable fixture with 10 entries and approximately 50 links, using
   `symlink(target, linkPath, 'junction')` pointing at real target directories.
   Give every normal target a root `SKILL.md`; assert the actual root-entry/link
   count and target resolution. Do not assume a loop created 50 working links.
2. Measure **T1 = `listEntries`** and **T2 = the complete `listRoute` path** through
   the registered list handler, including link decoration and `deriveGroupStates`.
   Timing only the scanner or only the decorator is not T2.
3. For each before/after boundary, perform **3 warmups and at least 20 samples**;
   report median and p95 with sample count, fixture counts, runtime/platform and
   measurement scope. Keep fixture and timing boundaries comparable.
4. Use `--cpu-prof` and count relevant sampled frames for attribution, separately
   from wall-clock timing. Sampled frames are not exact FS-call counters. Do not
   patch `fs/promises` after application imports and assume already-bound named
   imports were intercepted.

Measure the real `~/.dsh` environment separately and **read-only**. Synthetic
junction results cannot stand in for real target layouts or Windows Defender's
possible amplification of `realpath` latency. Report the real and synthetic
populations separately, including their differing counts and layouts.

There is a concrete read-only hazard: `readManifest` writes a `.corrupt-…` backup
when JSON parsing fails. Before calling the real-directory list path, establish
that the manifest is valid or absent and that this backup-write path will not be
triggered. If this cannot be guaranteed, stop the real-directory run and report
the limitation. This design authorizes neither repairing the manifest nor writing
anything into the real home. Temporary scripts and profiles belong outside it.

If sandbox restrictions prevent spawning the measurement process, use the local
terminal as directed by the user. Report blocked or unavailable measurements;
never invent numbers or substitute the call-count model for timings. Remove the
temporary script, fixtures and profiles after use; do not commit them.

### Candidate evaluation

Only measured attribution to a significant remaining bottleneck, followed by
semantic differential evidence, can justify the following P3 candidates:

| Candidate | Constraint and comparison to preserve |
|---|---|
| Skip preview after target `stat` fails | Keep disabled-link reporting and the current link-name fallback; demonstrate equivalent failure behavior |
| Reuse P1 targets | Consume the already canonical target; do not resolve the link again during decoration |
| Deduplicate name work by physical target within one request | Share the parsed name or an absent-name result, never one alias's final fallback; apply each alias's own fallback independently |
| Bound decoration concurrency | Use a constant pool limit of 8 rather than nested unbounded FS work; preserve entry and link order |
| Single-file locator/name path | Read `src/locator.ts` and `src/resolve.ts` first; compare discovery priority, first-skill selection, invalid/empty names, unreadable files and fallback behavior against the existing path |

`locateSkillFiles` **already** performs a root `SKILL.md` `stat` and returns early
when it is a file. A proposal must not claim this fast path is absent. Each list
request must still read current frontmatter truth; a persistent or cross-request
name cache is not a substitute. For normal independent targets with root files,
roughly \(2L\) calls for locating `stat` plus `readFile` are the name-reading lower
bound under this contract, **not the lower bound for the entire route**.

Low benefit is a valid reason to record every candidate without implementing any
of them. The later P3 measurement log and P1 verification addendum must contain
actual before/after T1/T2 median and p95, attribution, and the disposition of each
candidate. They are future evidence, not additional artifacts to create during
this documentation-only step.

### Measurement log and disposition

Step 4's measurement pass produced the following numbers on the synthetic fixture
defined in "Reproducible measurement boundaries". Runtime and platform: Windows
25H2 (win32 10.0.26200) / Node v24.19.0 / tsx 4.23.12. Fixture: N = 10 managed
entries, L = 50 junction links under `repos/perf-eXX/skills/eXX-sK`, each target
root carrying a valid-frontmatter `SKILL.md`. Sampling: 3 warmups + 20 samples,
median / p95, two independent runs reported side by side.

| Boundary | Run 1 median/p95 (ms) | Run 2 median/p95 (ms) |
|---|---|---|
| manifest-only (guardrail) | 0.18 / 0.35 | 0.19 / 0.25 |
| T1 old (per-entry scan, oracle) | 185.31 / 212.45 | 174.29 / 196.26 |
| T1 current (`listEntries`) | 8.93 / 9.42 | 7.20 / 8.80 |
| T2 old (reference scan + decoration) | 200.26 / 220.04 | 166.76 / 174.20 |
| T2 current (complete handler) | 12.61 / 14.35 | 12.39 / 14.13 |

P1 wall-clock speedup: T1 ≈ 20.8× / 24.2×, T2 ≈ 15.9× / 13.5×. In the old T2
about 90% of the time is the repeated scan. **Net decoration cost after P1**
(T2 − T1, guardrail subtracted, normalized against the net T2): **3.68–5.19 ms,
or 29.6–42.5% of net T2** — the trigger condition for the "record every
candidate without implementing" branch (Section 4's closing paragraph) did not
fire on this synthetic population.

CPU attribution (30 s budget per path; sampled frames are not FS-call counters):

- **T1** (3434 rounds / 20760 frames) self: idle 82.5%, fs-native 8.5%
  (`realpath` 8.2%), (program) 3.7%, scan(app) 2.6%, node-internal 2.4%.
- **T2** (2495 rounds / 20825 frames) self: idle 66.3%, fs-native 11.4%
  (including decoration's `stat(link.target)` at 3.3%), decor(app+yaml) 7.6%
  (yaml `.next` 2.0%, `locateSkillFiles` 0.6% — the root-SKILL.md early return
  is confirmed by measurement), (program) 6.8%, node-internal 5.6%, scan(app)
  1.5%, route-shell 0.4%.
- `realpath` is the largest non-idle category on both paths (once per scanned
  link plus base-path normalization in the scan).

Real `~/.dsh` group measured separately and read-only. Manifest pre-flight was
valid (35 B, `entries = 0`), the skills root enumerated 0 names, and the
`.corrupt-…` backup path was confirmed not to fire. T1 median = 0.10 / p95 =
0.14 ms; T2 median = 0.15 / p95 = 0.21 ms (n = 20 + 3 warmups). Before/after
snapshots (directory listing, manifest size:mtime) were bit-for-bit unchanged.
Honestly labelled: at the time of this log the real population sits at N = 0 /
L = 0 — an unloaded floor latency, not a substitute for the synthetic
population in the disposition reasoning below.

All numbers come from real runs; no measurement was blocked or unavailable.
Temporary scripts, logs and fixtures were removed afterwards and verified
absent.

Per-candidate disposition against this evidence (mirrors the Section 5 table):

1. **Failed-stat preview skip** — recorded, not implemented. The synthetic
   fixture has 50 live targets and the real home is empty, so the failure path
   carried no measured attribution. `locateSkillFiles` already returns `[]`
   promptly for a missing target (the root `SKILL.md` `isFile` fails, `readdir`
   fails), so the saving is bounded to two failing FS calls that are already
   cheap. Reopen per Section 5's condition.
2. **Reuse P1 canonical target** — recorded, not implemented (already realized
   by P1 rule 5). Direct read of `listRoute`: `stat(link.target)` and
   `linkSkillName(link.target, ...)` consume the canonical string `scanEntryLinks`
   produced; a `grep` for `realpath`/`resolveLinkTarget`/`safeRealPath` in the
   decoration body returns nothing. There is no avoidable duplicate resolution
   to demonstrate.
3. **Bound decoration concurrency** — **implemented**. Net T2 − T1 attributed
   cost is well above the "low benefit" threshold; `listRoute` now wraps both
   nesting levels in `mapBounded(..., LINK_SCAN_CONCURRENCY)` (8) — the same
   primitive `scanEntryLinks` uses, so no second concurrency constant is
   introduced. Order and failure-path semantics are pinned by the existing
   list tests plus a new order-preservation test with 10 entries and 9 links
   on the first entry, which exceeds the ceiling at both nesting levels.
   Post-P3 T2 accounting is deferred to the final accounting step.
4. **Single-file locator/name path** — recorded, not implemented. Root
   `SKILL.md` early return already exists in `src/locator.ts:32-35` and was
   confirmed by the profile (`locateSkillFiles` self-time 0.6%, yaml `.next`
   2.0%); all 50 fixture targets hit the fast path. A parallel single-file
   name path would re-implement discovery priority (root/SKILL.md vs.
   subdir/SKILL.md vs. flat .md) and carries more drift risk than measured
   benefit.
5. **Deduplicate name work by physical target within one request** — recorded,
   not implemented. Step 4 fixture had 50 independent targets (no repeated
   physical target) and the real home had L = 0. The Section 5 condition
   ("Measured repeated-target cost and differential alias/fallback coverage")
   has no supporting evidence at this time.

## 5. Known non-work — three disposition tiers

P1's consolidated scan and P2's complete snapshots/early polling are the selected
designs. The tables below distinguish conditional follow-up work from rejected
substitutes; they do not turn every nearby opportunity into implementation scope.

### Conditional P3 adjuncts

| Item | Why not automatic work | Condition to open or revisit | Disposition after Step 4 |
|---|---|---|---|
| Failed-stat preview skip | May save only an error-path cost and can alter fallback behavior | Significant measured attribution and matching failure-path semantics | Recorded, not implemented (no measured failure-path attribution; `locateSkillFiles` already returns `[]` fast on a missing target) |
| P1 target reuse in decoration | Avoidable duplicate resolution must be demonstrated, not assumed | Evidence of redundant work and unchanged canonical-target behavior | Recorded, not implemented (already realized by P1 rule 5; `listRoute` reads `link.target` directly and issues no `realpath`/`resolveLinkTarget` during decoration) |
| Request-local physical-target name deduplication | Independent targets gain nothing; aliases have different fallbacks | Measured repeated-target cost and differential alias/fallback coverage | Recorded, not implemented (fixture had 50 independent targets; real home L = 0) |
| Decoration pool of 8 | Scheduling changes need not improve latency on every filesystem | Significant attributed cost plus boundedness and ordering evidence | **Implemented** — `listRoute` now uses `mapBounded(..., LINK_SCAN_CONCURRENCY)` at both nesting levels; order preserved by the pool's indexed assembly and pinned by a new route-level test |
| Single-file locator/name path | Root-file early return already exists; duplicated discovery rules are risky | Remaining measured discovery cost and passing layout/name differential tests | Recorded, not implemented (fast path confirmed by profile; parallel path would re-implement discovery priority) |

These are the candidates from P3, not permission to implement them incidentally
while doing P1 or P2.

### Separate implementation commits

| Item | Reason for separation | Execution or revisit condition |
|---|---|---|
| `checkUpdates` remote checks | Network `ls-remote` concurrency is separate from local list FS work | An already included independent step: use a pool of 3–5, preserve manifest result order, and inject an executor to test both the concurrency ceiling and ordering. Do not add a new per-candidate authorization or independent measurement prerequisite |
| CLI command imports on demand | Startup module loading is separate from warm list-route latency | **Done (P4-2).** Measured on Windows 25H2 / Node v24.19.0 against an isolated empty home, `node lib/cli/index.js list` cold start over two independent passes of 3 warmup + 20 `spawnSync` samples: static imports median 130.86 / 129.23 ms (p95 136.13 / 141.82), bare-node floor ≈ 55 ms, lazy dispatcher median 97.42 / 101.80 ms (p95 102.96 / 105.55). The ≈30 ms of unselected command-module load (≈23% of the cold start; distributions cleanly separated at old min 124.46 vs new max 108.25) exceeded the observable-increment threshold, so it was implemented rather than skipped. Revisit if a future change reintroduces static command imports |

The current dispatcher imports **15 command modules plus one usage module = 16**;
its separate `cliIO` import brings the top-level total to **17**. This is not
16 command modules. Any lazy-import implementation belongs in the dispatcher,
loading command modules on demand; it must not expand into a `cliIO` redesign.
The remote-check step remains part of the plan with its own tests and commit,
not an unapproved new optimization request. The normal phase gates and handoff
rules below still apply to both items.

### Rejected alternatives

| Alternative | Reason for rejection | Reopening condition |
|---|---|---|
| Remove canonicalization | Breaks ownership when ancestor paths are rewritten | A new explicit path/ownership contract and separate approval |
| Remove dangling-target fallback | Loses recoverable POSIX targets needed for attribution and cleanup | A new explicit dangling-link contract and separate approval |
| Partition into only the first matching bucket | Changes parent/subdir overlap semantics | A new explicit ownership-consistency contract and separate approval |
| Remove the CLI `present` `stat` | Link attribution does not prove directory presence | A new explicit list-state contract and separate approval |
| Delete group-state compensation without passing full snapshots | Reintroduces stale group switches and inconsistent entries/groups | A new explicit snapshot-consistency contract and separate approval; P2 instead preserves the data before removing the request |
| Unbounded FS or git concurrency | Trades repeated work for uncontrolled resource pressure | A new explicit resource/concurrency contract and separate approval |
| Cache names instead of reading frontmatter each request | Replaces current on-disk truth with stale display state | A new explicit freshness/invalidation contract and separate approval |

No unrelated optimization requirements are implied by these reopening conditions.

## 6. Acceptance, artifacts and staged handoff

### Verification for later implementation phases

Before advancing from any implementation phase, `npm run typecheck`,
`npm run lint` and `npm test` must all pass. Record failures, platform skips and
warnings honestly; a passing format check or a smaller estimated call count is
not a performance result.

- **P1:** require old/new per-entry differential equality, the five scanner rules,
  concurrency/order evidence and all four named guardrails. Register the new test
  in the explicit package script and clean up its temporary directories.
- **P2:** require complete snapshots on tick/success/timeout, actual panel request
  counts and injected-sleep sequences. Static rendering is additional evidence,
  not a substitute for orchestration or interaction coverage.
- **P3:** require measured T1/T2 median/p95 and candidate decisions, with real-home
  results separate from synthetic results. Only measured evidence supports a
  claim of speedup; unavailable real-home evidence must remain labelled unavailable.
- **Separate steps:** retain the remote-check executor ceiling/order tests and
  the CLI cold-start comparison described above; register any added test file in
  the explicit test list.

Any `src` change, including comments, requires `npm run build` and inclusion of
the applicable rebuilt `lib/` artifacts in its implementation commit. Client
changes additionally require `npm run build:client`, including `lib/client.js`
and `lib/client-types/`. Use Node **^22.18.0 || >=24.11.0** for that client build;
this toolchain requirement does not redefine the package's general runtime floor.
Use `npm run test:build` for the test-compilation check in the full gate sequence.
Never hand-edit generated output.

### Branch and commit boundaries

- Work on `perf/list-loading`. The documentation-first step starts only from the
  clean baseline `d59c2b3c931a3108e78ea416bfc23c0802aa4155`; stop if the branch,
  baseline or clean state differs, or if either target document already exists.
- The documentation-first commit would contain only this document and its Chinese
  translation, with no CHANGELOG change. The current writing task stops before
  implementation, quality gates, builds or committing: independent Verify runs
  the tests/gates afterward, and committing requires separate authorization after
  those gates pass. Do not push, create a worktree, delegate, or create additional
  reports, ledgers, briefs or planning artifacts for this step.
- Later `perf`/`fix` atomic commits keep code, tests, applicable generated output
  and the corresponding `CHANGELOG.md` entry together. Entries must be
  self-contained and state how to verify or recognize the change, without external
  review or conversation identifiers. Pure README/docs changes belong in separate
  documentation commits. This design adds no command or flag, so README changes
  are not needed.
- After each phase's authorized commit, hand off the evidence and stop rather than
  starting the next phase automatically. Push and release remain the user's
  decision; passing local checks does not authorize either.

### Final accounting

At the end of implementation, repeat the complete final gates, rebuild the server
output and the client output where applicable, rerun the benchmark for the final
T1/T2 accounting, and remove all temporary measurement artifacts. Compare the
final changed-file scope against the accepted phase boundaries before handoff.

For the documentation-only step, self-check only the two new files and Git diff
scope, then return their paths, six-section coverage, any deviations/questions and
Git status. Do not run the later gates or create a separate report file. This
text defines future acceptance boundaries; it records no implementation, test
pass or measured improvement.

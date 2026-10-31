# Verifying panel list-loading and interaction responsiveness (P1–P4)

This guide verifies the performance and semantics contract locked in by the
**panel list-loading and interaction responsiveness** commits. They change how
the list / update / startup paths work internally but do **not** change link
attribution, list output, group-state derivation, exit codes or shell completion:

- **P1 · consolidated link scan** — `listEntries` folds the "one root scan per
  entry" work into a single pass: the root is `readdir`-ed once, each link is
  resolved once, buckets keep the original `readdir` order, and one link may land
  in both a parent and a nested subdir bucket. Attribution, removal and collision
  safety stay byte-for-byte identical.
- **P3 · bounded decoration pool** — `listRoute`'s decoration body (target `stat`
  + frontmatter read) moves from nested unbounded `Promise.all` to
  `mapBounded(..., LINK_SCAN_CONCURRENCY = 8)` at both nesting levels; output
  order and failure fallback are unchanged.
- **P2 · full panel snapshots + earlier poll backoff** — `reconcileList` now
  returns `{ entries, groupStates }`, so the panel no longer issues a redundant
  successful-tail `api.list()`; `pollJob`'s first two waits are fixed at 200 ms and
  400 ms, then settle back to `intervalMs` (the panel's 800 ms and the helper's
  default 1000 ms are two distinct steady values).
- **P4-1 · `checkUpdates` remote concurrency** — the per-entry serial
  `git ls-remote` in `src/health.ts` becomes a bounded pool of constant 4,
  `UPDATE_CHECK_CONCURRENCY = 4`, with results still assembled in manifest order.
- **P4-2 · lazy CLI command imports** — `src/cli/index.ts` moves the 15 command
  modules and usage out of top-level static imports and into
  `await import(...)` inside the dispatcher, so cold start no longer loads the
  transitive graph of unselected commands.

> **Shell warning** — the end-to-end measurement blocks are given for Git Bash
> (Windows) and POSIX/Linux/macOS. Every block uses an absolute path or an
> isolated `DSH_HOME` under a temp directory, is deleted afterwards, and never
> touches your real `~/.dsh`; the read-only real-home step is separate and carries
> its own guard.

## Prerequisites

- Node.js ≥ 20 (the client build needs `^22.18.0 || >=24.11.0`) and `git` on `PATH`
- Repository checked out and `npm install` run (the tests rely on `tsx` in
  `node_modules`)
- If `src/` changed, run `npm run build` first — the performance blocks below
  exercise the compiled `lib/`; the focused test blocks run `src/` via `tsx`
- What you expect is **magnitude and a clean before/after separation**, not a hard
  threshold: host, Windows Defender and filesystem all shift absolute milliseconds

---

## Part 1 — Test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run lint        # ESLint 9 + typescript-eslint — expect: 0 errors
npm run build       # tsc → lib/
npm test            # node:test + tsx — expect: 861 tests / 858 pass / 3 skipped (bash/zsh/fish completion) / 0 fail
```

Focused regression anchors for these commits:

```bash
node --import tsx --test test/link-scan.test.ts     # P1 scan consolidation: differential equality + five invariants + bounded concurrency
node --import tsx --test test/api.test.ts           # P3 decoration pool: entry and link order preservation
node --import tsx --test test/health.test.ts        # P4-1 checkUpdates: result order + concurrency ceiling
node --import tsx --test test/client-api.test.ts    # P2 reconcileList full snapshots + poll early-backoff sequence
node --import tsx --test test/completions.test.ts   # P4-2 CLI dispatcher source shape: command modules are dynamic imports
```

| Test file | What it verifies | Turns red when the matching commit is broken |
|---|---|---|
| `test/link-scan.test.ts` | Keeps the pre-change per-entry implementation as a reference oracle and, on the same untouched fixture, runs `deepStrictEqual` for the bulk bucket and the single-entry wrapper separately (order and target strings included); fixtures cover live managed/subdir/external, dangling POSIX (recovered via `readlink`) and Windows dangling junctions (skipped, no invented ownership, branch chosen by `DANGLING_LINKS_OBSERVABLE`), real dir/file in the root, nested parent+subdir double-bucket, missing clone dir, missing root (asserts the scan does not create it), ancestor rewritten by `realpath`, a 20-link bucket order = `readdir`; and `mapBounded` returning input order despite reverse completion with observed concurrency `>1` (no idle false-proof) and `≤ 8` | Switching assembly to "first match wins" → double-bucket case red; scrambling bucket order → order case red; unbounded fan-out → ceiling case red |
| `test/api.test.ts` | The new "list preserves entry and link order once the bounded decoration pool engages": 10 entries exceed the outer ceiling and the first entry's 9 links exceed the inner one, asserting `entries[i].name` = manifest insertion order and the first entry's `links.map(linkName)` = the prefix order of a fresh `readdir` of the skills root; the three existing list cases (empty manifest, `list-alpha` single link, `list-linked` foreign entry) pin the response shape | Reassembling `mapBounded` by completion order → order red; changing the response schema → existing cases red |
| `test/health.test.ts` | Two injected-executor cases: (1) latency decreases with index (the first started finishes last), asserting the returned `name` sequence equals manifest order; (2) `active`/`peak` counters wrap the executor, asserting `peak ≤ UPDATE_CHECK_CONCURRENCY` and `> 1`, with `N = 10 >` the ceiling | Assembling results by completion order → order red; no concurrency ceiling → `peak ≤ 4` red; pool degraded to serial → `peak > 1` red |
| `test/client-api.test.ts` | `reconcileList` returns full snapshots carrying `groupStates` on tick/success/timeout (older responses missing the field fall back to empty); k polls trigger exactly k list calls (no `k+1`); an injected `sleep` asserts the panel (`intervalMs:800`) long-job sequence 200/400/800/800… and the helper default 200/400/1000/1000…; immediate settlement asserts zero sleeps for each of done/error/cancelled; `maxWaitMs:0` asserts zero sleeps (the deadline check precedes any wait) | Steady interval folded into the first two steps → sleep sequence red; a leftover successful-tail `api.list()` → count k≠k+1 red |
| `test/completions.test.ts` | The source-shape assertion "dispatcher loads command modules lazily, never as a top-level import": `src/cli/index.ts` must not contain a static `import … from './commands/'` line and must reference the 15 command modules exactly as `import('./commands/<x>.js')` (self-skips in `test-dist/` where no `.ts` exists); the existing four-completion-template case-label guards keep matching command names | Dispatcher reverted to top-level static imports → source-shape assertion red |

---

## Part 2 — End-to-end verification (performance re-run)

Both scripts time the same boundaries: **T1 = `listEntries`** and **T2 = the full
`listRoute` path** through the registered handler (decoration +
`deriveGroupStates`), plus a manifest-only guard rail. The fixture is
\(N=10\) managed entries with \(L=50\) junction links into
`repos/perf-eXX/skills/eXX-sK`, each target root carrying a valid-frontmatter
`SKILL.md`. Each boundary does 3 warmups + 20 samples, reports median/p95, and
two independent processes are compared.

The key fact: `src/paths.ts` reads `DSH_HOME` / `DSH_SKILLS_NEXUS_HOME` at
**import time**, so the fixture home must be set **before** dynamically importing
application modules; switching variables after a static import does not relocate
an already loaded graph. Use `.mts` (a `.ts` under tsx is parsed as CJS and
rejects top-level await).

### Git Bash / POSIX

```bash
PROJECT=/c/Users/you/dsh-skills-nexus           # ← your repo path (POSIX form)
TMP="$(mktemp -d)"
export PERF_REPO="$PROJECT" PERF_BASE="$TMP"

cat > "$TMP/bench.mts" <<'MJS'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const REPO = process.env.PERF_REPO, BASE = process.env.PERF_BASE
const pct = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo) }
async function timeIt(fn) {
  for (let i = 0; i < 3; i++) await fn()
  const s = []
  for (let i = 0; i < 20; i++) { const t = performance.now(); await fn(); s.push(performance.now() - t) }
  s.sort((a, b) => a - b); return { median: pct(s, .5), p95: pct(s, .95) }
}
const home = await mkdtemp(join(BASE, 'home-'))
process.env.DSH_HOME = home
process.env.DSH_SKILLS_NEXUS_HOME = join(home, 'skills-nexus')   // must precede the dynamic import
const paths = await import(pathToFileURL(join(REPO, 'src', 'paths.ts')).href)
const manifest = await import(pathToFileURL(join(REPO, 'src', 'manifest.ts')).href)
const link = await import(pathToFileURL(join(REPO, 'src', 'link.ts')).href)
const routes = await import(pathToFileURL(join(REPO, 'src', 'http', 'routes.ts')).href)
const skills = []
for (let e = 0; e < 10; e++) {
  const ex = String(e).padStart(2, '0'), base = join(paths.repoDir(`perf-${ex}`), 'skills')
  await mkdir(base, { recursive: true })
  for (let k = 0; k < 5; k++) {
    const t = join(base, `perf-${ex}-s${k}`); await mkdir(t, { recursive: true })
    await writeFile(join(t, 'SKILL.md'), `---\nname: perf-${ex}-s${k}\n---\nbody\n`, 'utf8')
    await link.linkSkill(`perf-${ex}-s${k}`, t)
  }
  skills.push({ name: `perf-${ex}`, url: `github:owner/perf-${ex}#main`, gitUrl: `https://github.com/owner/perf-${ex}.git`, ref: 'main', path: `perf-${ex}`, subdir: 'skills', addedAt: new Date().toISOString() })
}
await manifest.writeManifest({ version: 1, skills })
const listed = await manifest.listEntries()
if (listed.length !== 10) throw new Error('fixture guard: entries != 10')
if (listed.reduce((n, l) => n + l.links.length, 0) !== 50) throw new Error('fixture guard: links != 50')
const spec = routes.createNexusRoutes().find((s) => s.path === '/skills-nexus/list')
const callList = async () => {
  const L = {}, req = { method: 'GET', url: '/skills-nexus/list', headers: {}, socket: {}, on: (e, c) => ((L[e] ??= []).push(c), req) }
  const done = Promise.resolve(spec.handler(req, { writeHead() {}, end() {} }))
  for (const cb of L.end ?? []) cb(); await done
}
console.log(JSON.stringify({ guard: await timeIt(() => manifest.readManifest()), t1: await timeIt(() => manifest.listEntries()), t2: await timeIt(callList) }))
await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
MJS

cd "$PROJECT"                       # run from the repo so --import tsx can resolve tsx
node --import tsx "$TMP/bench.mts"  # first pass
node --import tsx "$TMP/bench.mts"  # second independent pass
rm -rf "$TMP"
```

> Swap `src/` for `lib/`, drop `--import tsx`, and point `PERF_REPO` at `lib` to run
> the compiled variant (requires `npm run build` first); the logic is identical,
> only the module resolver differs.

Expected output (magnitude, not a hard threshold):

```
guard  median ≈ 0.1–0.2 ms
t1     median ≈ 7–9 ms   (the pre-consolidation per-entry oracle is ~170–185 ms → a ~20× magnitude gap)
t2     median ≈ 11–13 ms (the old scan+decoration reference is ~167–200 ms)
```

Measured record (Windows 25H2 / Node v24.19.0 / tsx 4.23.12, fixture `N=10 / L=50`,
two independent processes at 3 warmups + 20 samples, both precondition guards
confirming `entries=10, links=50`):

| Boundary | Run 1 median/p95 (ms) | Run 2 median/p95 (ms) |
|---|---|---|
| manifest-only (guard rail) | 0.11 / 0.18 | 0.17 / 0.25 |
| T1 `listEntries` | 7.88 / 8.65 | 7.44 / 8.87 |
| T2 complete handler | 11.29 / 12.84 | 10.72 / 11.99 |

Against the pre-commit baseline (same fixture, pre-consolidation implementation):
T1 ≈ 185 / 174 ms, T2 ≈ 200 / 167 ms; once the bounded decoration pool was wired
in, the T2 median is in fact slightly below the P1-only ~12.5 ms, with no regression.

### CLI cold-start A/B (P4-2)

The static-vs-lazy difference is only ~30 ms, so it must be measured with a
**fresh process each sample** against an isolated empty home to see the
distributions separate.

```bash
PROJECT=/c/Users/you/dsh-skills-nexus
TROOT="$(mktemp -d)"; export DSH_HOME="$TROOT/home" DSH_SKILLS_NEXUS_HOME="$TROOT/skills-nexus"
mkdir -p "$DSH_HOME/skills" "$DSH_SKILLS_NEXUS_HOME"     # missing manifest → early "No skills registered", no .corrupt backup write
cd "$PROJECT"
# after npm run build; sample lib/cli/index.js `list` cold start 20 times (+3 warmups), report median/p95
node -e 'const {spawnSync}=require("child_process");const p=[];for(let i=0;i<23;i++){const r=process.hrtime.bigint();spawnSync("node",["lib/cli/index.js","list"],{stdio:"ignore"});p.push(Number(process.hrtime.bigint()-r)/1e6)}p.sort((a,b)=>a-b);const q=(s)=>p[Math.floor((p.length-1)*s)];console.log("list cold-start median",q(.5).toFixed(2),"p95",q(.95).toFixed(2))'
rm -rf "$TROOT"
```

Expected magnitude (Windows 25H2 / Node v24.19.0): bare `node -p 0` floor ≈ 55 ms;
lazy-dispatcher `list` ≈ 97–102 ms; reverting to top-level static imports ≈
129–131 ms. The before/after distributions must separate cleanly (measured old min
124.46 vs new max 108.25); if they overlap, the change did not take effect or the
noise is too high.

### Real `~/.dsh` (read-only, optional)

Measure the real home separately and **read-only**: before calling the list path,
confirm the manifest is valid or absent, otherwise a JSON parse failure makes
`readManifest` write a `.corrupt-…` backup. If you cannot guarantee that, stop and
report honestly. After the run, the before/after snapshots (directory listing,
manifest size:mtime) must be bit-for-bit unchanged. Report the real and synthetic
populations separately.

---

## Implementation behavior worth knowing (not defects)

1. **`realpath` is the largest non-idle CPU category on the list path** — once per
   scanned link plus base-path normalization. CPU profile (30 s budget per path;
   sampled frames are not FS-call counters): T2 self idle 66.3%, fs-native 11.4%
   (including decoration's `stat(link.target)` 3.3%), decor(app+yaml) 7.6% (yaml
   `.next` 2.0%, `locateSkillFiles` 0.6% — the root-`SKILL.md` early return is
   confirmed by measurement), (program) 6.8%, node-internal 5.6%, scan(app) 1.5%,
   route-shell 0.4%.
2. **`checkUpdates` progress-line emission order is not deterministic under the
   pool** — `io.progress` is a best-effort hint, not a contract, so worker progress
   lines no longer arrive in a fixed order. `test/update-pipeline.test.ts`
   **intentionally** compares the `io.stages` assertion as a set after `.sort()` on
   both sides — do not revert it to an ordered assertion; the result-array order is
   still pinned by `deepStrictEqual` and a dedicated keeps-order case.
3. **The two concurrency constants are deliberately different** —
   `LINK_SCAN_CONCURRENCY = 8` bounds cheap local `readlink`/`realpath`;
   `UPDATE_CHECK_CONCURRENCY = 4` bounds "one `git ls-remote` subprocess + one
   outbound connection per entry" — 4 covers typical manifest sizes while keeping the
   process/connection footprint small and avoids conflating it with the scan pool.
4. **`locateSkillFiles` already early-returns on a root `SKILL.md` `isFile`** — no
   "single-file" proposal may claim that fast path is absent; every list still reads
   current frontmatter truth and a cross-request name cache is not a substitute.

---

## Pitfalls hit in practice

1. **env read at import time.** Set `DSH_HOME` / `DSH_SKILLS_NEXUS_HOME` before
   dynamically importing `src`/`lib`; running `node --import tsx` from **outside the
   workspace** gives `ERR_MODULE_NOT_FOUND: tsx` — `cd` back into the repo and pass
   the absolute script path, or use `.mjs` + `lib/` to avoid `tsx`.
2. **Don't skip the fixture guard.** Assert the real `entries == 10 && links == 50`;
   never assume a loop produced 50 working junctions. The `mkdtemp` home is created
   after `linkSkill` builds the root and must be deleted at the end.
3. **`Promise.all → mapBounded` must assemble by index.** Pool workers finish out of
   order; pushing by completion order breaks `entries` (manifest order) and `links`
   (`readdir` order) — the order cases in `test/api.test.ts` and
   `test/link-scan.test.ts` exist precisely to catch this.
4. **Windows dangling junctions.** `readlink` gives `EINVAL` and `lstat` sees a plain
   directory; only `realpath` resolves them. An unrecoverable dangling junction is
   skipped rather than assigned from its link name — `test/link-scan.test.ts` selects
   that branch explicitly via `DANGLING_LINKS_OBSERVABLE`.
5. **Read-only real home.** See Part 2: confirm the manifest is valid/absent to avoid
   the `.corrupt-…` backup write; keep temp scripts and profiles outside the real
   home, delete them after, and verify absence (`Test-Path`/existence check).
6. **PowerShell 5.1 gotchas.** Never round-trip non-ASCII source through
   `Get-Content | Set-Content` (the default encoding injects FFFD); `npm test`
   output is localized (`ℹ pass`/`ℹ fail`), so `Select-String 'fail'` catches
   nothing — take the tail lines; the PowerShell error styling on the first line of
   `npm run build/typecheck/lint` is notice noise — trust `$LASTEXITCODE`; use
   `git -C <dir>` and leave no `cd` side effects across shells.

---

## Coverage boundaries

This guide does **not** cover (all deliberate):

- **Absolute millisecond thresholds.** The synthetic-fixture numbers are magnitude
  references; host / Defender / filesystem shift them. The criterion is a clean
  before/after distribution separation and relative gain, not a fixed ms.
- **A speedup verdict from the real `~/.dsh`.** At record time the real home sits at
  `N=0 / L=0` (an unloaded floor: T1 ≈ 0.10 ms, T2 ≈ 0.15 ms), which only proves the
  read-only guard triggers no write — it is not the basis for a verdict.
- **Real git network concurrency.** The order + ceiling cases in `test/health.test.ts`
  use an injected executor to observe in-flight count, not a real `git ls-remote`;
  the real six-state git matrix belongs to `test/update-pipeline.test.ts`.
- **Browser panel interaction.** `test/panel-render.test.tsx` is an SSR static-render
  guard that runs no effects and is not click/poll/request-count evidence; that is
  carried by the orchestration mocks in `test/client-api.test.ts`.
- **User-facing semantics.** This work adds no command or flag and does not change
  attribution, removal/collision protection, the `list --json` schema, group-state
  derivation, exit codes or completion, so the README's user-facing sections are
  unchanged.

# Contributing to dsh-skills-nexus

> [中文](CONTRIBUTING.zh-CN.md) | **English**

Thanks for your interest in contributing! This guide covers the source
layout, local development setup, and quality gates.

For local testing of the running tool (build → overlay → DSH → verify),
see the **[Local testing steps](README.md#local-testing-steps)** section
in the README — that's the user-facing end-to-end flow.

## Project layout

```
src/
├── index.ts          # Cordis plugin entry — lazily registers the /skills-nexus/* routes in web hosts
├── cli/
│   ├── index.ts      # dispatcher
│   ├── args.ts       # tiny argv parser
│   ├── glob.ts       # * / ? glob expansion for remove
│   ├── progress.ts   # TTY-gated spinner (add / update)
│   ├── prompt.ts     # interactive confirm
│   └── commands/     # add · list · update · switch-version · remove · toggle · doctor · completions
├── client/           # browser half — excluded from the server build, bundled by build:client
│   ├── index.tsx     # module shape: name / inject / apply (Settings slot)
│   ├── api.ts        # typed HTTP client + confirmable / pollJob / reconcileList
│   └── panel.tsx     # the Skills Nexus settings panel
├── http/             # /skills-nexus/* routes: types / util (envelope + guards) / jobs / io / routes
├── ops-io.ts         # OpsIO seam: emit / progress / interactive / confirm + NeedsConfirm
├── locks.ts          # three-layer concurrency: in-process single-flight, cache lock, O_EXCL file lock
├── switch-version.ts # switch orchestration (fetch → checkout → re-normalize → rebuild links)
├── zip.ts            # minimal PKZip reader/writer — the package codec (hardened)
├── health.ts         # checkUpdates extraction (six states) + doctor checks
├── update-cache.ts   # in-process update cache (never persisted)
├── link.ts           # symlink management (link/unlink/collision/target-attribution scan)
├── resolve.ts        # parse cloned repos into discovered skills (previewSkills + isValidSkillName)
├── manifest.ts       # manifest.json read/write/find/add/remove + listEntries
├── locator.ts        # locate SKILL.md inside a clone (3 discovery layouts)
├── frontmatter.ts    # yaml-based frontmatter parser + normalizer
├── git.ts            # parseGitSpec / cloneRepo / pullRepo / fetch (execFile, no shell)
├── paths.ts          # official skills root / repos / manifest / locks path constants
├── types.ts          # Manifest / SkillEntry types
└── repo-kind.ts      # classify cloned repos (plain / wrapped / plugin / unknown)
```

Runtime dependency is just `yaml`. In a **web** host, `index.ts` lazily injects
the web server and registers the `/skills-nexus/*` routes (plus the settings
panel through the client half); in non-web hosts the plugin stays dormant.
Skill discovery itself never depends on the plugin layer — it goes through
symlinks to the official filesystem provider.

For the full architecture (data flow, directory layout, SKILL.md discovery
rules), see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Development: testing & CI

> **Want to verify a feature end-to-end?**
> - [Verifying the version-lock feature (P0)](docs/verify-version-lock.md) —
>   test suite, branch fast-forward, tag pinning, drift recovery, re-add guard.
> - [Verifying the clone-retry feature (P0)](docs/verify-clone-retry.md) —
>   test suite, exponential-backoff observation, branch/tag/commit-SHA clone regression.
> - [Verifying collection-repo support (P1)](docs/verify-collection-support.md) —
>   `--subdir` installs, flat-md filtering, large-collection guards.
> - [Verifying the `doctor` command (P0)](docs/verify-doctor.md) —
>   read-only checkup: report statuses/codes, exit codes, `--json` / `--updates` / `--quiet`, orphan & corrupt-manifest handling.
> - [Verifying shell completion (P1–P2)](docs/verify-completions.md) —
>   bash / zsh / fish / PowerShell templates: per-shell drivers, layered scenarios, engine quirks.
> Each is a copy-paste walkthrough for Windows / Linux / macOS.

Quality gates, all runnable locally:

```bash
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # ESLint 9 + typescript-eslint (flat config)
npm test              # unit tests — node:test + tsx, no extra framework
npm run build         # tsc → lib/
npm run test:build    # tsc -p tsconfig.test.json → test-dist/ (type-checks test/)
npm run build:client  # tsdown + tsc → lib/client.js + lib/client-types/ (browser half)
```

`npm run build:client` bundles the browser half (`src/client/`) and emits its
types separately. It is deliberately **not** part of `npm run build` or CI:
tsdown's engine floor (Node ^22.18 || >=24.11) exceeds the Node 20 entry of
the support matrix, so the client bundle is built locally on a new-enough
Node and committed, like the rest of `lib/`.

The test suite lives in `test/` and targets the pure-logic modules:

| module | covered by | what is verified |
|---|---|---|
| `src/git.ts` | `test/git.test.ts` | `parseGitSpec` (all accepted repo forms), `repoSlug`, `sanitizeName`, `retry` (exponential backoff), `cloneRepo` (branch/tag/commit-SHA) |
| `src/frontmatter.ts` | `test/frontmatter.test.ts` | frontmatter + body split, malformed YAML, block scalars, CRLF, `flag()` |
| `src/locator.ts` | `test/locator.test.ts` | the 3 SKILL.md discovery layouts, skipped files, hidden dirs |
| `src/repo-kind.ts` | `test/repo-kind.test.ts` | repo classification: plain / wrapped / plugin / unknown |
| `src/cli/args.ts` | `test/args.test.ts` | the tiny argv parser |
| `src/manifest.ts` | `test/manifest.test.ts` | manifest read/write round-trips against a temp `DSH_HOME` |
| `src/resolve.ts` | `test/resolve.test.ts` | `previewSkills` (preview skills), `isValidSkillName` validation |
| `src/link.ts` | `test/link.test.ts` | `linkSkill` / `isEntryEnabled` / `unlinkSkill` / `hasCollision` against a temp `DSH_HOME` — exercises the real Windows junction vs macOS/Linux symlink code paths |
| `src/ops-io.ts` | `test/ops-io.test.ts` | byte-equal stdout capture through the OpsIO seam, TTY gating in both directions, `NeedsConfirm` |
| `src/zip.ts` | `test/zip.test.ts` | hand-built zip fixtures: `readZip` / `createZip` round trip plus the full rejection matrix (zip-slip, size bombs, zip64, encrypted, …) |
| `src/switch-version.ts` | `test/switch-version.test.ts` | branch↔tag↔sha end-to-end, missing ref leaves zero changes, dirty-clone discard, link rebuild, CLI wrapper |
| `src/locks.ts` | `test/locks.test.ts` | O_EXCL write/release, live-lock refusal, stale-PID / timeout / corrupt-file recovery, in-process single-flight |
| `src/http/` (routes) | `test/api.test.ts` | the 11-route table over fake req/res — envelope dialects, 409 confirm-required, toggle target attribution, the retired add-zip route, hotReload states |
| `src/client/api.ts` | `test/client-api.test.ts` | the typed client over a recording fake fetch — envelopes, confirmable retry, `pollJob`, `reconcileList` |

`npm run test:build` compiles `src/` + `test/` to `test-dist/` for a
loader-free run (`node --test test-dist/test/`), useful where tsx's loader
is unavailable.

CI (`.github/workflows/ci.yml`) runs on push/PR across a matrix of
`ubuntu` / `windows` / `macos` × Node 20/22/24. Typecheck, lint, unit tests,
and build run on all three OS, so the Windows junction (`symlink(...,
'junction')` in `src/link.ts`) and the macOS/Linux symlink code paths are both
exercised. The "committed `lib/` matches a fresh build" check is pinned to
`ubuntu-latest` only: `tsc` output is deterministic and OS-independent, and
limiting that one step to Linux avoids false `git diff` positives caused by
Windows CRLF / `core.autocrlf`. Because the repo is public, the extra OS
runners cost nothing — the only trade-off is longer queue time.

### Lint the workflow locally with actionlint (optional, before you push)

`actionlint` statically checks `.github/workflows/*.yml` — matrix/expression
syntax, `runs-on`, `if`, `shell`, action versions — so you catch a broken
workflow before spending a push on it. It is **not** wired into CI on purpose:
GitHub already rejects an invalid workflow at parse time, so running actionlint
there would be redundant. Use it as a local pre-push check only.

Install (needs a Go toolchain; the binary lands in `$(go env GOPATH)/bin`,
e.g. `C:\Users\<you>\go\bin\actionlint.exe` on Windows — make sure that
directory is on your `PATH`):

```bash
go install github.com/rhysd/actionlint/cmd/actionlint@latest
```

Run it from the repo root (exit code `0` and no output = pass):

```bash
actionlint                              # scan every file under .github/workflows/
actionlint .github/workflows/ci.yml     # or just the one you changed
```

> actionlint optionally shells out to `shellcheck` (bash `run:` bodies) and
> `pyflakes` (python `run:` bodies). If they are not installed it prints a
> "rule disabled" notice and skips them — the core workflow checks still run.
> Our only bash step is a trivial `git diff`, so installing shellcheck is
> optional.

## Commit & pull request conventions

- **Conventional Commits** — prefix every commit with a type (and optional scope):
  `feat(scope):`, `fix(scope):`, `docs:`, `ci:`, `build:`, `refactor:`, `test:`, `chore:`.
- **Separate code from docs** — keep functional changes (`src/`, `test/`, and the
  rebuilt `lib/`) and pure-documentation changes (README / CONTRIBUTING / `docs/`) in
  **separate commits**. A `feat`/`fix` commit carries its code, tests, rebuilt `lib/`,
  and the CHANGELOG entry; a following `docs:` commit carries only the prose files.
- **Update `CHANGELOG.md` before you commit**, in the same commit as the change it
  describes, under `## [Unreleased]`, following
  [Keep a Changelog](https://keepachangelog.com/).
- **Opening a PR** — the [pull request template](.github/PULL_REQUEST_TEMPLATE.md)
  prefills the description with a quality checklist that mirrors the CI gates above;
  fill it in and note any platform-specific behavior for the reviewer.

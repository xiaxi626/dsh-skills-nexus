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
├── index.ts          # Cordis plugin entry (empty apply(), exists for dsh plugin add)
├── link.ts           # symlink management (link/unlink/collision check)
├── resolve.ts        # parse cloned repos into discovered skills (previewSkills + isValidSkillName)
├── manifest.ts       # manifest.json read/write/find/add/remove
├── locator.ts        # locate SKILL.md inside a clone (3 discovery layouts)
├── frontmatter.ts    # yaml-based frontmatter parser + normalizer (normalizeSkillName / ensureDescription)
├── git.ts            # parseGitSpec / cloneRepo / pullRepo (execFile, no shell)
├── paths.ts          # official skills root / repos / manifest path constants
├── types.ts          # Manifest / SkillEntry types
├── repo-kind.ts      # classify cloned repos (plain / wrapped / plugin / unknown)
└── cli/
    ├── index.ts      # dispatcher
    ├── args.ts       # tiny argv parser
    └── commands/     # add · list · update · remove · toggle
```

Runtime dependency is just `yaml`. `index.ts`'s `apply()` is a no-op — no
custom provider is registered; all skill discovery goes through symlinks to
the official filesystem provider.

For the full architecture (data flow, directory layout, SKILL.md discovery
rules), see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Development: testing & CI

> **Want to verify a feature end-to-end?**
> - [Verifying the version-lock feature (P0)](docs/verify-version-lock.md) —
>   test suite, branch fast-forward, tag pinning, drift recovery, re-add guard.
> - [Verifying collection-repo support (P1)](docs/verify-collection-support.md) —
>   `--subdir` installs, flat-md filtering, large-collection guards.
> Both are copy-paste walkthroughs for Windows / Linux / macOS.

Quality gates, all runnable locally:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint 9 + typescript-eslint (flat config)
npm test            # unit tests — node:test + tsx, no extra framework
npm run build       # tsc → lib/
```

The test suite lives in `test/` and targets the pure-logic modules:

| module | covered by | what is verified |
|---|---|---|
| `src/git.ts` | `test/git.test.ts` | `parseGitSpec` (all accepted repo forms), `repoSlug`, `sanitizeName` |
| `src/frontmatter.ts` | `test/frontmatter.test.ts` | frontmatter + body split, malformed YAML, block scalars, CRLF, `flag()` |
| `src/locator.ts` | `test/locator.test.ts` | the 3 SKILL.md discovery layouts, skipped files, hidden dirs |
| `src/repo-kind.ts` | `test/repo-kind.test.ts` | repo classification: plain / wrapped / plugin / unknown |
| `src/cli/args.ts` | `test/args.test.ts` | the tiny argv parser |
| `src/manifest.ts` | `test/manifest.test.ts` | manifest read/write round-trips against a temp `DSH_HOME` |
| `src/resolve.ts` | `test/resolve.test.ts` | `previewSkills` (preview skills), `isValidSkillName` validation |

`npm run test:build` compiles `src/` + `test/` to `test-dist/` for a
loader-free run (`node --test test-dist/test/`), useful where tsx's loader
is unavailable.

CI (`.github/workflows/ci.yml`) runs on push/PR across Node 18/20/22:
typecheck, lint, unit tests, build, and a check that the committed `lib/`
still matches a fresh build.

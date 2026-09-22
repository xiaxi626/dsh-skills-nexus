# Building on nexus — machine interfaces for tool authors

> [中文](build-on-nexus.zh-CN.md) | **English**

You want to build a tool — a GUI, a sync daemon, a CI job, a higher-level
installer — that installs GitHub `SKILL.md` repos into DSH. This page is the
contract you can build on, and, just as importantly, the list of things that
are **not** promised so you never build on sand.

## Why build on nexus instead of reinventing it

"Install this GitHub skill into DSH" sounds like one `git clone`. It is not.
A correct installer has to handle a pile of fiddly, cross-platform problems —
all of which nexus already solves and hides behind one command:

- **Repo spec parsing** — `github:owner/repo[#ref]`, full `https://` URLs
  (including `/tree/<ref>/...` subpaths), `git+https://`, `git@` / `ssh://`,
  and bare `owner/repo` shorthand all resolve to the same clone.
- **Clone with retry** — shallow clone with bounded exponential-backoff retry,
  so a flaky network does not leave a half-installed skill.
- **Ref pinning + a lock** — pin a branch, tag, or commit with `#ref`; the
  resolved commit is recorded as a lightweight lock. `update` fast-forwards
  branch pins but only *verifies* tag/commit pins (restoring drift), so a
  pinned version never silently moves.
- **Frontmatter normalization** — invalid kebab-case names are fixed and a
  missing `description` is filled in at install time, so the official provider
  never silently skips a skill because of bad frontmatter.
- **Collection repos** — `--subdir` installs one skill out of a bundle; flat
  `*.md` docs are filtered out; installing more than 20 skills at once is
  guarded by a confirmation prompt.
- **Symlink materialization** — one symlink per skill in `~/.dsh/skills/`,
  using Windows directory junctions where needed — no Developer Mode, no admin.
- **Discovery is free** — the official DSH filesystem provider scans
  `~/.dsh/skills/` and serves the skills; there is no custom provider to write
  or maintain.

All of this is dependency-free and runs anywhere Node ≥ 20 does. Your tool gets
it by running `dsh-skills-nexus add …` and reading state back through the two
stable interfaces below — instead of re-implementing clone/pin/normalize/link
and getting the Windows-junction and frontmatter edge cases wrong.

## The interfaces you can depend on (two, both read-only)

Nexus exposes exactly two machine-readable read paths. Both are stable
contracts; everything else about the CLI is human-facing and may change.

### `list --names` — enumerate installed skills

- One skill name per line, in manifest order — no header, no column padding,
  no footer.
- An empty manifest prints **nothing** (the human "No skills registered." hint
  is deliberately absent on this path).
- Exit codes: `0` listed, `1` manifest unreadable, `2` usage error. On a usage
  error stdout stays empty and the message goes to stderr, so a broken call can
  never be mistaken for "zero skills".
- `--names` rejects an inline value: `--names=false` is a usage error, not a
  silent `true`.

This is the **authoritative** way to enumerate installed skills. Do not parse
`manifest.json` — see the won't-do register below for why.

### `doctor --json` — a versioned health report

- Emits a stable, versioned report on stdout as 2-space-indented JSON with a
  trailing newline. Top-level shape:

```json
{
  "version": 1,
  "checks": [
    { "id": "manifest", "status": "ok", "detail": "1 entry (version 1)", "issues": [] },
    { "id": "symlinks", "status": "error", "issues": [
        { "severity": "error", "code": "missing-target", "name": "demo",
          "fix": "dsh-skills-nexus update demo" }
    ] }
  ],
  "summary": { "errors": 1, "warnings": 0, "updates": 0 }
}
```

- **Check ids**, in order: `manifest`, `roots`, `symlinks`, `orphan-repo`,
  `orphan-link`, `git-sanity`, and `updates` (present only with `--updates`).
- **`status`** is one of `ok`, `warn`, `error`, `update-available`.
- Each issue is `{ severity, code, name, fix?, detail? }` where `severity` is
  `error` / `warn` / `info`. The `code` values are stable identifiers:
  `corrupt-manifest`, `orphan-check-skipped`, `root-unreadable`,
  `missing-target`, `orphan-repo`, `orphan-link`, `dangling-link`,
  `unreadable-link`, `corrupt-backup`, `missing-git`, plus `behind-remote` and
  `locked` (the latter two only under `--updates`).
- Exit codes: `0` no error, `1` at least one error, `2` usage error.
- `--updates` adds a network check comparing branch pins to their remote;
  `--quiet` prints nothing unless there is at least one error.
- `doctor` is **read-only** — it never writes the manifest, clones, or symlinks.

The full meaning of every check and code, with fix hints, lives in
[Verifying the `doctor` command](verify-doctor.md).

## What does NOT exist (read this before you build)

Being explicit so you never depend on a surface nexus has not promised:

- **No write-side machine output.** `add` / `update` / `remove` / `enable` /
  `disable` print human text only — there is no `--json` on them and no
  structured result object. Drive them by **exit code**, then re-query state
  with `list --names` / `doctor --json`.
- **`add` silently ignores unknown flags.** This is a deliberate tolerance for
  its many options — a mistyped flag will not error, it will just run with
  defaults. Validate your argv before shelling out.
- **No `list --json` (yet).** It is deliberately reserved as a separate future
  track; today `--names` is the only machine path for enumeration. If it ever
  ships, `--names` stays.
- **No Cordis service / provider / hook.** The plugin `apply()` is an
  intentional no-op — you **cannot** consume nexus through `ctx` at runtime.
  Skill discovery is entirely symlink + the official filesystem provider.
- **Package internals are not a public API.** The CLI is the only supported
  interface. Do not `import` package submodules (`./resolve` and everything
  else) and do not read `manifest.json` — the internal schema and module
  layout change without notice. This decoupling is the whole reason
  `list --names` exists (the same reason git completion calls `for-each-ref`
  rather than reading `.git/refs/`).

## How to integrate

- **Shell out to the CLI.** Read `list --names` line by line and `doctor --json`
  as JSON. The shipped shell-completion scripts are the reference consumer —
  they fetch installed names via `list --names` and never touch
  `manifest.json`.
- **Respect the ecosystem boundary.** Nexus controls skill *visibility* by
  symlink presence in `~/.dsh/skills/`. Other skill managers use a Policy-state
  model instead. If one skill is managed by both, the two models can disagree
  (one shows it "off" while the other still serves it). If you build a UI or
  manager on nexus, own one side of that boundary and say so in your docs.
- **Automation is safe.** Nexus never executes anything from a cloned repo and
  never runs the repo's build/install scripts, so invoking it from a daemon or
  CI job runs no untrusted code.

## Stability & maintenance

- **Stable — safe to depend on:** the `list --names` output shape and exit
  codes; the `doctor --json` `version` field, top-level shape, check ids,
  `status` enum, issue `code` values, and exit codes.
- **Not stable:** the human table output of `list`; the human report text of
  `doctor`; anything reached by importing package internals or reading
  `manifest.json`.
- When the `doctor --json` `version` bumps, the JSON contract has changed in a
  breaking way — pin to the version you tested against and gate on it.

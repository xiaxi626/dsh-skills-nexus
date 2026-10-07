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

## The interfaces you can depend on

Nexus exposes four machine-readable paths. All four are stable contracts;
everything else about the CLI is human-facing and may change.

- **Read-only:** `list --names` and `doctor --json` (below).
- **Write-side:** `add --json`, `update --json`, `remove --json`,
  `enable --json`, `disable --json`, and `list --json` — one shared contract,
  documented under "The `--json` write interface" further down.

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
- `--names` and `--json` are mutually exclusive: they are two different machine
  shapes, and there is no sensible answer for "both".

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
- Each issue is `{ severity, code, name, fix?, detail?, locked? }` where `severity` is
  `error` / `warn` / `info`. The `code` values are stable identifiers:
  `corrupt-manifest`, `orphan-check-skipped`, `root-unreadable`,
  `missing-target`, `orphan-repo`, `orphan-link`, `dangling-link`,
  `unreadable-link`, `corrupt-backup`, `missing-git`, plus `behind-remote` and
  `locked` (the latter two only under `--updates`).
- Exit codes: `0` no error, `1` at least one error, `2` usage error.
- `--updates` adds a network check comparing branch pins to their remote.
  A `locked` issue carries optional `locked: true` only for an explicit package
  lock; an ordinary detached tag/commit pin omits it. `--quiet` prints nothing
  unless there is at least one error.
- `doctor` is **read-only** — it never writes the manifest, clones, or symlinks.

The full meaning of every check and code, with fix hints, lives in
[Verifying the `doctor` command](verify-doctor.md).

## The `--json` write interface (version 1)

Five commands emit a versioned report describing what they just did:
`list --json`, `add --json`, `update --json`, `remove --json`, and
`enable` / `disable --json`. They share one contract, and it is deliberately
narrow:

### What is promised

- **`version: 1`** at the top level of every report. A breaking change bumps it
  to `2`; gate on the field.
- **Framing:** `JSON.stringify(report, null, 2)` plus one trailing newline.
- **Exit codes:** `0` success · `1` an error or a partial failure · `2` usage
  error. A per-item failure (one repo of three failed to clone) is exit `1`
  **with a complete report**, so you can read which item failed without
  re-querying.
- **stdout purity:** with `--json`, stdout carries the report document and
  nothing else. Every human line the command would have printed is suppressed,
  so `JSON.parse(stdout)` never needs a filter in front of it.
- **Diagnostics stay on stderr**, and are explicitly *not* part of the
  contract. A run may print warnings there; read them for a human, not a
  program.

### What is NOT promised

- **Object key order.** Field names and types are contract; their order is not.
- **Human output wording.** Without `--json`, text is unchanged from before —
  but the wording itself was never a contract.
- **`error` message text.** Only the presence of an `error` field is promised;
  the string may change in any release.
- **`links[].target` path format.** Absolute, platform-dependent.

### Never prompts

`--json` runs are non-interactive (`interactive: false`), and a prompt is
answered with its default. Anything that would have asked — the wrapped-repo
question, the large-collection guard, a glob that matched several skills — is
therefore **refused** rather than confirmed. Pass `--yes` where the human run
would have been asked; a refusal is visible in the report (`status: "skipped"`,
or `status: "not-found"` / exit `2` for a multi-match glob) rather than silent.

### The reports

`list --json`:

```json
{
  "version": 1,
  "entries": [
    {
      "name": "daily-trend-writer",
      "url": "github:owner/repo",
      "ref": "main",
      "subdir": null,
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "locked": true,
      "hasGitSource": true,
      "ownership": "managed",
      "enabled": true,
      "links": [{ "linkName": "daily-trend-writer", "target": "/abs/path" }],
      "update": null
    }
  ]
}
```

- `hasGitSource` is the server-side predicate (`gitUrl.length > 0`), **not**
  derived from `url` — every entry has a `url` and it is never empty. It decides
  whether the entry is automatically updatable.
- `ownership` is `managed` (nexus created `repos/<path>`) or `external` (a
  `--link-only` adoption of a directory nexus does not own; `remove` never
  deletes such a directory).
- `commit` is the recorded lockfile-lite value, `null` when none was recorded,
  not a fresh `git rev-parse`.
- `locked` is present and `true` only for an explicit package lock created by
  `import --locked`; ordinary entries omit it.
- `update` is `null` (never checked in this process) or
  `{ "hasUpdate": bool, "latestCommit": string|null, "checkedAt": ISO }`.

`add --json`:

```json
{
  "version": 1,
  "results": [
    { "spec": "github:o/r", "status": "added", "name": "r", "commit": "abc",
      "ref": "main", "links": ["r"] }
  ],
  "summary": { "added": 1, "skipped": 0, "failed": 0 }
}
```

- `status` ∈ `added` | `skipped` | `failed`. `skipped` and `failed` carry
  `code` (the install core's stop reason where it supplied one: `no-skill-md`,
  `no-installable-skills`, `subdir-not-found`, `dsh-plugin-repo`, `aborted`) or
  `error` (the preflight's own explanation: `already-registered`, `collision`,
  `locked`).
- `subdir` is present only when one was given.

`update --json`:

```json
{
  "version": 1,
  "results": [
    { "name": "r", "status": "updated", "ref": "main",
      "fromCommit": "abc", "toCommit": "def" }
  ],
  "summary": { "updated": 1, "failed": 0 }
}
```

- `status` ∈ `updated` | `up-to-date` | `pinned` | `failed`. `pinned` means the
  clone is on a tag/commit pin and was verified rather than moved.
- `toCommit` is `null` on failure. Bare `update --json` (no name) covers every
  enabled entry.

`remove --json`:

```json
{
  "version": 1,
  "results": [{ "name": "r", "status": "removed", "links": ["r"] }],
  "summary": { "removed": 1, "failed": 0 }
}
```

- `status` ∈ `removed` | `not-found` | `failed`. A glob token that matched
  nothing appears as its own `not-found` item, under the pattern as given.

`enable` / `disable --json` (both accept several names, like `remove`):

```json
{
  "version": 1,
  "results": [
    { "name": "r", "action": "enable", "status": "toggled",
      "enabled": true, "linksChanged": 1, "already": false }
  ],
  "summary": { "toggled": 1, "already": 0, "failed": 0 }
}
```

- `status` ∈ `toggled` | `already` | `not-found` | `failed`.
- `enabled` is the entry's **resulting** state: a `not-found` item reports the
  state it keeps, not the one it was asked for.
- `linksChanged` counts symlinks created (enable) or removed (disable).

### Errors

- **Usage error** (argv the command rejects): exit `2`. If `--json` was asked
  for, stderr carries `{ "version": 1, "error": { "message": "…" } }`; stdout
  stays empty.
- **Unexpected fatal**: the same shape on stderr, exit `1`.
- **Per-item failure**: inside the report's `results[]`, exit `1`.

## What does NOT exist (read this before you build)

Being explicit so you never depend on a surface nexus has not promised:

- **No `--json` on `export` / `import` / `adopt` / `switch-version`.** They are
  deliberately out of the version-1 write contract: `export` and `import` carry
  a package format, and `adopt` / `switch-version` are long-running jobs whose
  structured status belongs to the HTTP job channel. Drive them by exit code,
  then re-query with `list --json`.
- **No streaming or incremental JSON.** Each report is written once, whole, at
  the end of the run. A job-style progress stream is not part of this contract.
- **`add` silently ignores unknown flags.** This is a deliberate tolerance for
  its many options — a mistyped flag will not error, it will just run with
  defaults. Validate your argv before shelling out. (`--json=false` *is*
  rejected, because silently reading it as `true` would hand you a report you
  did not ask for.)
- **No Cordis service / provider / hook.** The plugin `apply()` is an
  intentional no-op — you **cannot** consume nexus through `ctx` at runtime.
  Skill discovery is entirely symlink + the official filesystem provider.
- **Package internals are not a public API.** The CLI is the only supported
  interface. Do not `import` package submodules (`./resolve` and everything
  else) and do not read `manifest.json` — the internal schema and module
  layout change without notice. This decoupling is the whole reason
  `list --names` and `list --json` exist (the same reason git completion calls
  `for-each-ref` rather than reading `.git/refs/`).

## How to integrate

- **Shell out to the CLI.** Read `list --names` line by line and any `--json`
  output as JSON. The shipped shell-completion scripts are the reference
  consumer — they fetch installed names via `list --names` and never touch
  `manifest.json`.
- **Prefer `--json` over scraping text.** `nexus add gitlab:group/repo --json`
  tells you the resolved commit, the entry name and the links created in one
  parse; the same information from the human output would be a regex against
  prose that is explicitly not a contract.
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
  `status` enum, issue `code` values, and exit codes; and for every `--json`
  command, the `version` field, the report shape and field names, the `status`
  enums, and the exit-code meanings above.
- **Not stable:** the human table output of `list`; the human report text of
  `doctor`; the `error` / `detail` message strings inside any report; the order
  of keys inside a report object; anything reached by importing package
  internals or reading `manifest.json`.
- When a `version` bumps, that JSON contract has changed in a breaking way —
  pin to the version you tested against and gate on it.

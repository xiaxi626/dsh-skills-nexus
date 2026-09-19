# Verifying the `doctor` command (P0)

This guide verifies the **`doctor`** command — a read-only, offline-by-default
full checkup of nexus state:

- `doctor` inspects the manifest, the two roots (`repos/`, `skills/`), every
  entry's symlink, orphaned clones / links, and each clone's `.git`, then prints
  an aligned report and exits **0** (clean), **1** (at least one error) or **2**
  (usage error).
- `--json` emits a stable machine-readable contract (`version: 1`); `--updates`
  additionally compares **branch-pinned** entries against their remote
  (network); `--quiet` prints nothing unless there is at least one error (CI
  convenience).
- `doctor` **changes nothing** — it never writes the manifest, clones or
  symlinks, and it is *not* wired into the plugin `apply()`, which stays a
  no-op.

> **Shell warning — Windows users: run the walkthrough in Git Bash (MINGW64),
> not PowerShell.** Every block below is POSIX / Bash. Do not paste it into a
> PowerShell terminal. Commands use absolute paths or `git -C <dir>` and a
> `nexus()` shell function — nothing `cd`s into your project, so your working
> tree cannot be polluted.

Everything below is safe: it uses an isolated `DSH_HOME` under a temp dir, a
local `file://` remote stands in for GitHub (no network for the local checks),
and your real `~/.dsh` is never touched. Delete the temp dirs at the end.

## Prerequisites

- Node.js ≥ 20 and git on `PATH`
- Repo checked out and `npm install` done (tests run via `tsx` from `node_modules`)
- If you changed `src/`, run `npm run build` first — the walkthrough runs the
  compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: all tests pass
npm run build       # tsc → lib/
npm run test:build  # optional: compile src+test to test-dist/ for loader-free runs
```

The suite never touches your real environment: every test file uses a temp
`DSH_HOME` plus `mkdtemp` directories that `after()` hooks remove.

| test file | what it verifies |
|---|---|
| `test/doctor.test.ts` | fresh install is all-ok (exit 0); healthy install; broken symlink → `missing-target` (exit 1) with no orphan-link double-report; orphan-repo / orphan-link / dangling-link; corrupt manifest; **corrupt manifest suppresses orphan checks (no mass-delete false positives)**; **malformed entry is reported structurally, never throws**; `.corrupt-` backup; missing `.git`; `--json` version-1 contract; `--quiet`; usage errors (exit 2); `parseDoctorArgs`; `formatHuman` |
| `test/health.test.ts` | `diagnoseEntry` (`ok` / `disabled` / `missing-target`); `findOrphanRepos` / `findOrphanLinks` three-way classification (`orphan-link` / `dangling-link` / `unreadable-link`); `checkHealth`; `formatWarning` |

The two bolded `doctor.test.ts` cases are the regression anchors for the
boundary-protection rule: when the manifest is unreadable, ownership of clones
and links is *unknown*, so `doctor` must **skip** the orphan checks (a `warn`
with no delete hint) rather than flag everything for deletion.

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Set `PROJECT` to your checkout path. Each
scenario starts from a known state; destructive ones rebuild it explicitly.

### Windows (Git Bash / MINGW64)

```bash
PROJECT=~/Downloads/dsh-skills-nexus                 # ← your path (no trailing slash)
nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }

UP="$(cygpath -m "$TEMP/demo")"                       # upstream repo dir is named "demo"
HOME_DEMO="$(cygpath -m "$TEMP/nexus-doctor-home")"
rm -rf "$UP" "$HOME_DEMO"                             # clean slate
export DSH_HOME="$HOME_DEMO"
URL="file:///$UP"

# ---- build a local upstream repo (stands in for GitHub) ----
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥ 2.28
git -C "$UP" config user.email t@t
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"
git -C "$UP" add .
git -C "$UP" commit -m init

# ---- S1) fresh install: empty DSH_HOME → all ok, exit 0 ----
nexus doctor; echo "exit=$?"

# ---- S2) healthy install ----
nexus add "$URL" --name demo
nexus doctor; echo "exit=$?"                          # all ok, exit 0
nexus doctor --quiet; echo "exit=$?"                  # silent, exit 0
nexus doctor --json | head -n 5                       # "version": 1, "checks": [ … ]
nexus doctor foo; echo "exit=$?"                      # usage error, exit 2
nexus doctor --json=x; echo "exit=$?"                 # usage error, exit 2

# ---- S3) orphan-repo: a clone no entry references (warn, exit 0) ----
mkdir -p "$DSH_HOME/skills-nexus/repos/leftover"
nexus doctor; echo "exit=$?"                          # orphan-repo warn, exit 0
rmdir "$DSH_HOME/skills-nexus/repos/leftover"

# ---- S4) missing-target: delete the clone, keep entry + symlink (error, exit 1) ----
rm -rf "$DSH_HOME/skills-nexus/repos/demo"
nexus doctor; echo "exit=$?"                          # symlinks FAIL + git-sanity warn; orphan-link stays empty
# restore by re-registering (update cannot re-clone a fully-deleted repo — see Pitfalls)
nexus remove demo --yes
nexus add "$URL" --name demo

# ---- S5) corrupt manifest: unreadable file (error, exit 1; orphan checks skipped) ----
MANIFEST="$DSH_HOME/skills-nexus/manifest.json"
cp "$MANIFEST" "$MANIFEST.bak"
printf '{ not json' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # manifest FAIL; orphan-repo/orphan-link = warn (not scanned, counts as 2 warnings); NO delete hints
mv "$MANIFEST.bak" "$MANIFEST"

# ---- S6) manifest drift: valid but empty manifest while clone + symlink remain ----
printf '{"version":1,"skills":[]}' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # orphan-repo + orphan-link warn, exit 0

# ---- cleanup ----
rm -rf "$UP" "$HOME_DEMO"
unset DSH_HOME
```

### Linux / macOS

```bash
PROJECT=~/dsh-skills-nexus                            # ← your path (no trailing slash)
nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }

UP=/tmp/nexus-doctor/demo                             # upstream repo dir is named "demo"
HOME_DEMO=/tmp/nexus-doctor/home
rm -rf /tmp/nexus-doctor
export DSH_HOME="$HOME_DEMO"
URL="file://$UP"

# ---- build a local upstream repo (stands in for GitHub) ----
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥ 2.28; older: git init && git -C "$UP" symbolic-ref HEAD refs/heads/main
git -C "$UP" config user.email t@t
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"
git -C "$UP" add .
git -C "$UP" commit -m init

# ---- S1) fresh install: empty DSH_HOME → all ok, exit 0 ----
nexus doctor; echo "exit=$?"

# ---- S2) healthy install ----
nexus add "$URL" --name demo
nexus doctor; echo "exit=$?"                          # all ok, exit 0
nexus doctor --quiet; echo "exit=$?"                  # silent, exit 0
nexus doctor --json | head -n 5                       # "version": 1, "checks": [ … ]
nexus doctor foo; echo "exit=$?"                      # usage error, exit 2
nexus doctor --json=x; echo "exit=$?"                 # usage error, exit 2

# ---- S3) orphan-repo: a clone no entry references (warn, exit 0) ----
mkdir -p "$DSH_HOME/skills-nexus/repos/leftover"
nexus doctor; echo "exit=$?"                          # orphan-repo warn, exit 0
rmdir "$DSH_HOME/skills-nexus/repos/leftover"

# ---- S4) missing-target: delete the clone, keep entry + symlink (error, exit 1) ----
rm -rf "$DSH_HOME/skills-nexus/repos/demo"
nexus doctor; echo "exit=$?"                          # symlinks FAIL + git-sanity warn; orphan-link stays empty
nexus remove demo --yes
nexus add "$URL" --name demo

# ---- S5) corrupt manifest: unreadable file (error, exit 1; orphan checks skipped) ----
MANIFEST="$DSH_HOME/skills-nexus/manifest.json"
cp "$MANIFEST" "$MANIFEST.bak"
printf '{ not json' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # manifest FAIL; orphan-repo/orphan-link = warn (not scanned, counts as 2 warnings); NO delete hints
mv "$MANIFEST.bak" "$MANIFEST"

# ---- S6) manifest drift: valid but empty manifest while clone + symlink remain ----
printf '{"version":1,"skills":[]}' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # orphan-repo + orphan-link warn, exit 0

# ---- cleanup ----
rm -rf /tmp/nexus-doctor
unset DSH_HOME
```

---

## Part 3 — `--updates` (version-lock aware)

`--updates` is the only networked check. It compares each **branch-pinned**
entry's recorded `commit` against the remote tip (`git ls-remote`). A
**tag/commit pin** (detached HEAD) is an intentional fixed point: it is reported
as `locked` (info) and never as "behind". `--updates` results are `info`-level —
they never count as errors/warnings and never change the exit code.

With the local `file://` remote from Part 2 this is fully hermetic:

```bash
# (state: demo re-added on branch main, upstream unchanged)
nexus doctor --updates; echo "exit=$?"    # updates ok — local == remote, exit 0

# advance the upstream branch, then re-check
printf -- '---\nname: demo\ndescription: v2\n---\n# demo v2\n' > "$UP/SKILL.md"
git -C "$UP" add .
git -C "$UP" commit -m second
nexus doctor --updates; echo "exit=$?"    # updates "update" — behind-remote (info), exit STILL 0
nexus update demo                          # fast-forwards and re-stamps the lock
nexus doctor --updates; echo "exit=$?"    # back to ok
```

A tag pin shows the `locked` path instead:

```bash
git -C "$UP" tag v1.0.0
nexus remove demo --yes
nexus add "$URL#v1.0.0" --name demo
nexus doctor --updates                     # updates: demo → locked (info), never "behind"
```

Against a real GitHub repo the behaviour is identical; only the remote differs.

---

## Reading the report

### Checks (in report order)

| check id | what it inspects |
|---|---|
| `manifest` | `manifest.json` presence, parseability, `version`/`skills` shape and per-entry structure; leftover `.corrupt-` backups |
| `roots` | `repos/` and `skills/` exist and are readable |
| `symlinks` | each entry's symlink resolves to an existing directory |
| `orphan-repo` | clone dirs under `repos/` that no entry references |
| `orphan-link` | symlinks into `repos/` that no entry claims |
| `git-sanity` | each clone still has a `.git` |
| `updates` | (only with `--updates`) branch pins vs their remote |

### Status → label → counting

| status | human label | counts toward | affects exit code |
|---|---|---|---|
| `ok` | `ok` | — | no |
| `warn` | `warn` | `warnings` | no |
| `error` | `FAIL` | `errors` | yes → exit 1 |
| `update-available` | `update` | `updates` | no |

Exit codes: **0** = no error, **1** = at least one error, **2** = usage error
(unknown option, positional argument, or an inline value on a boolean flag such
as `--json=x`).

### Issue codes

| code | severity | meaning | suggested fix |
|---|---|---|---|
| `corrupt-manifest` | error | `manifest.json` unparsable, wrong `version`, or a malformed entry | inspect the file; a `.corrupt-` backup (if any) holds the last raw content |
| `corrupt-backup` | warn | a `manifest.json.corrupt-<ts>` backup exists | safe to delete once skills are re-added |
| `root-unreadable` | error | `repos/` or `skills/` exists but cannot be read | fix directory permissions |
| `missing-target` | error | an entry's symlink points at a missing directory | `remove <name>` then `add` again |
| `orphan-repo` | warn | a clone under `repos/` that no entry references | remove the stale clone, or re-add it |
| `orphan-link` | warn | a symlink into `repos/` that no entry claims | remove it, or re-add it |
| `dangling-link` | error | a symlink into `repos/` whose target is gone and no entry claims | remove the dangling symlink |
| `unreadable-link` | warn | `readlink` failed; ownership cannot be confirmed | inspect manually — do **not** delete blindly |
| `orphan-check-skipped` | warn | the orphan scan was skipped because the manifest is unreadable | repair the manifest first (see `corrupt-manifest`) |
| `missing-git` | warn | a clone is missing its `.git` | `remove <name>` then `add` again |
| `behind-remote` | info | a branch pin is behind its remote (`--updates` only) | `update <name>` |
| `locked` | info | a tag/commit pin, intentionally not tracking (`--updates` only) | none — this is expected |

### `--json` shape (stable contract, `version: 1`)

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

Issues are **inlined** under their check (there is no top-level `issues` array).
`severity` is `error` / `warn` / `info`; `status` is `ok` / `warn` / `error` /
`update-available`. Consumers should key off `version` and treat unknown codes
as forward-compatible.

---

## Pitfalls seen in practice

1. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.
2. **`update` does not re-create a fully-deleted clone.** It fast-forwards a
   branch pin or restores a drifted tag/commit pin, but if `repos/<name>` is
   gone entirely it errors. To repair a deleted clone, `remove <name>` then
   `add` again — which is why S4 restores state that way.
3. **A deleted clone trips two checks at once** — `symlinks` (`missing-target`,
   error) *and* `git-sanity` (`missing-git`, warn), because both look at the
   same missing directory. `orphan-link` deliberately stays empty: the link is
   still claimed by a live entry, so it is not an orphan (no double-report).
4. **Corrupt manifest ≠ missing manifest.** A missing manifest is a clean
   "nothing installed yet" (all ok). A present-but-unreadable one is an error,
   and because entry ownership is then unknown the orphan checks are **skipped**
   (warn, no delete hint) instead of flagging every healthy clone/link.
5. **The registered name is what you passed to `--name`** (here `demo`); the
   clone directory is the repo slug (also `demo`, since the upstream dir is
   named `demo`). Use `nexus list` to confirm both.
6. **Platform path formats.** Windows Git Bash: convert with `cygpath -m` and
   use `file:///C:/...` URLs. Linux / macOS: plain absolute paths and
   `file:///...` URLs.
7. **`git init -b main` needs git ≥ 2.28** (2019). Older git:
   `git init && git -C "$UP" symbolic-ref HEAD refs/heads/main`.
8. **Stale `$DSH_HOME`** — a previous run leaves entries behind. Delete the temp
   home (see cleanup) before starting fresh.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **Exhaustive orphan-link sub-cases** — `unreadable-link` and `dangling-link`
  need hand-crafted rogue symlinks that are fragile to create portably in a
  shell; they are covered deterministically by `test/doctor.test.ts` and
  `test/health.test.ts` instead.
- **Real GitHub network** — the local `file://` remote exercises the same
  `git ls-remote` path without network flakiness.
- **Plugin runtime** — `doctor` is a pure CLI command; the plugin `apply()`
  remains a no-op and never invokes it.
- **Node 20 / 22 / 24 matrix** — CI (`.github/workflows/ci.yml`) runs the full
  quality-gate set on push/PR.

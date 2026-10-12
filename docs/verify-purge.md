# Verifying the `purge` command

This guide verifies the **`purge`** command — a dry-run-by-default scanner that
cleans up four categories of accumulated artifacts:

- **`exports/*.zip`** — old export archives never garbage-collected.
- **`manifest.json.corrupt-*`** — atomic-write backups from corrupt manifest
  reads; each corruption event leaves one behind.
- **`upload-*`** — temporary directories from package import; a crash between
  `mkdir` and `rm` leaves them orphaned.
- **`rollback/<name>.json`** — recovery points for *removed* skills. Active
  skills' rollback files are **never** touched.

Default mode is a **dry-run**: scan and report, delete nothing. Pass `--yes` to
actually delete. `--json` emits a machine-readable report (`version: 1`).

A **24-hour mtime protection window** spares any artifact modified recently —
except `corrupt-manifest` backups, which are unconditionally safe to delete
(the live manifest has already moved on to the empty fallback).

> **Shell warning — Windows users: run the walkthrough in Git Bash (MINGW64),
> not PowerShell.** Every block below is POSIX / Bash. Do not paste it into a
> PowerShell terminal. Commands use absolute paths or `git -C <dir>` and a
> `nexus()` shell function — nothing `cd`s into your project, so your working
> tree cannot be polluted.

Everything below is safe: it uses an isolated `DSH_HOME` under a temp dir, a
local `file://` remote stands in for GitHub (no network), and your real
`~/.dsh` is never touched. Delete the temp dirs at the end.

## Prerequisites

- Node.js ≥ 20 and git on `PATH`
- Repo checked out and `npm install` done
- If you changed `src/`, run `npm run build` first — the walkthrough runs the
  compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: all tests pass
npm run build       # tsc → lib/
```

| test file | what it verifies |
|---|---|
| `test/purge.test.ts` | scan of all 4 categories; mtime guard spares recent items; corrupt-manifest bypasses the guard; `executePurge` records failures; CLI dry-run / `--yes` / `--json` output; active skill rollback files are never touched |
| `test/remove.test.ts` | `remove` cleans up the orphan rollback JSON for the removed skill |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.

### Linux / macOS

```bash
# ---- isolated DSH_HOME ----
export DSH_HOME=/tmp/nexus-purge
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"/{exports,rollback}
PROJECT=~/dsh-skills-nexus                              # ← your path
cd "$PROJECT"

# ---- A) seed artifacts in all 4 categories ----
# 1. export archive
echo "fake-zip-content" > "$DSH_HOME/skills-nexus/exports/backup-2026-10-01.zip"
# 2. corrupt-manifest backup
echo "corrupt-data" > "$DSH_HOME/skills-nexus/manifest.json.corrupt-2026-10-05T120000"
# 3. upload-temp directory (make it OLD — backdate mtime > 24h ago)
mkdir -p "$DSH_HOME/skills-nexus/upload-abc123"
echo "temp-data" > "$DSH_HOME/skills-nexus/upload-abc123/package.json"
touch -t 202601010000 "$DSH_HOME/skills-nexus/upload-abc123"         # old mtime
# 4. orphan rollback file (no matching skill in manifest)
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/removed-skill.json"

# ---- B) dry-run (default) ----
node lib/cli/index.js purge
# Expected: lists 4 artifacts with categories and sizes, ends with
# "Dry run — pass --yes to delete."

# ---- C) --json dry-run ----
node lib/cli/index.js purge --json
# Expected: JSON report with "version":1, "removed":0, "failed":[],
# and 4 entries in "files"

# ---- D) actually delete ----
node lib/cli/index.js purge --yes
# Expected: "Purged 4 artifact(s) (...)"

# ---- E) verify cleanup ----
ls "$DSH_HOME/skills-nexus/exports/"              # → empty
ls "$DSH_HOME"/manifest.json.corrupt-*  # → no matches
ls "$DSH_HOME"/upload-*              # → no matches
ls "$DSH_HOME/skills-nexus/rollback/"             # → empty

# ---- F) "Nothing to purge" ----
node lib/cli/index.js purge
# Expected: "Nothing to purge."

# ---- cleanup ----
rm -rf "$DSH_HOME"
unset DSH_HOME
```

### Windows (Git Bash / MINGW64)

```bash
# ---- isolated DSH_HOME ----
export DSH_HOME="$(cygpath -m "$TEMP/nexus-purge")"
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"/{exports,rollback}
PROJECT=~/Downloads/dsh-skills-nexus                    # ← your path
cd "$PROJECT"

# ---- A) seed artifacts ----
echo "fake-zip-content" > "$DSH_HOME/skills-nexus/exports/backup.zip"
echo "corrupt-data" > "$DSH_HOME/skills-nexus/manifest.json.corrupt-2026-10-05T120000"
mkdir -p "$DSH_HOME/skills-nexus/upload-abc123"
echo "temp-data" > "$DSH_HOME/skills-nexus/upload-abc123/package.json"
# Backdate mtime > 24h on Windows: use PowerShell via cmd
powershell -Command "(Get-Item '$DSH_HOME/skills-nexus/upload-abc123').LastWriteTime = (Get-Date).AddDays(-2)"
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/removed-skill.json"

# ---- B) dry-run ----
node lib/cli/index.js purge
# Expected: lists 4 artifacts, "Dry run — pass --yes to delete."

# ---- C) --json dry-run ----
node lib/cli/index.js purge --json

# ---- D) actually delete ----
node lib/cli/index.js purge --yes
# Expected: "Purged 4 artifact(s) (...)"

# ---- E) verify ----
ls "$DSH_HOME/skills-nexus/exports/"              # → empty
ls "$DSH_HOME/skills-nexus/rollback/"             # → empty

# ---- F) "Nothing to purge" ----
node lib/cli/index.js purge           # → "Nothing to purge."

# ---- cleanup ----
rm -rf "$DSH_HOME"
unset DSH_HOME
```

---

## Part 3 — mtime protection window

Artifacts modified within the last 24 hours are spared — except
`corrupt-manifest` backups.

### Linux / macOS

```bash
export DSH_HOME=/tmp/nexus-purge-mtime
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"
PROJECT=~/dsh-skills-nexus
cd "$PROJECT"

# A RECENT upload-temp (mtime = now, within 24h)
mkdir -p "$DSH_HOME/skills-nexus/upload-recent"
echo "fresh" > "$DSH_HOME/skills-nexus/upload-recent/data.bin"
# mtime is now — within the protection window

node lib/cli/index.js purge --yes
# Expected: the upload-recent dir is NOT deleted (mtime guard).
# Output should mention 0 purged or skip it.
ls "$DSH_HOME/skills-nexus/upload-recent/"        # → still present

# A RECENT corrupt-manifest backup (mtime = now)
echo "broken" > "$DSH_HOME/skills-nexus/manifest.json.corrupt-fresh"
# corrupt-manifest BYPASSES the mtime guard

node lib/cli/index.js purge --yes
# Expected: corrupt-manifest IS deleted despite fresh mtime.
ls "$DSH_HOME"/manifest.json.corrupt-*  # → no matches

rm -rf "$DSH_HOME"
unset DSH_HOME
```

### Windows (Git Bash)

Same commands with path substitutions:

```bash
export DSH_HOME="$(cygpath -m "$TEMP/nexus-purge-mtime")"
# ... same as above ...
rm -rf "$DSH_HOME"
unset DSH_HOME
```

---

## Part 4 — active skill rollback files are never purged

```bash
export DSH_HOME=/tmp/nexus-purge-active
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"/{rollback,repos}
PROJECT=~/dsh-skills-nexus
cd "$PROJECT"

# Create a minimal manifest with one skill
cat > "$DSH_HOME/skills-nexus/manifest.json" 2>/dev/null || {
  cat > "$DSH_HOME/skills-nexus/manifest.json" <<'EOF'
{"version":1,"skills":[{"name":"my-skill","path":"my-skill","url":"github:test/repo","gitUrl":"github:test/repo","ref":"main","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","links":[]}]}
EOF
}

# Rollback file for an ACTIVE skill — must NOT be purged
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/my-skill.json"
# Rollback file for a REMOVED skill — SHOULD be purged
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/gone-skill.json"

node lib/cli/index.js purge
# Expected: only "orphan-rollback: .../rollback/gone-skill.json" appears.
# my-skill.json is NOT listed (active skill).

node lib/cli/index.js purge --yes
# Expected: only gone-skill.json deleted; my-skill.json survives.
ls "$DSH_HOME/skills-nexus/rollback/"
# → my-skill.json still present

rm -rf "$DSH_HOME"
unset DSH_HOME
```

---

## What each step should print

| step | expected output | meaning |
|------|-----------------|---------|
| B: dry-run | `Found N artifact(s) (...):` + list + `Dry run — pass --yes to delete.` | scan only, nothing deleted |
| C: `--json` dry-run | `{"version":1,"files":[...],"totalSize":N,"removed":0,"failed":[]}` | machine-readable preview |
| D: `--yes` | `Purged N artifact(s) (...).` | actually deleted |
| E: verify | directories empty | artifacts gone |
| F: empty | `Nothing to purge.` | no artifacts found |
| mtime: recent upload | not deleted | 24h guard works |
| mtime: recent corrupt | deleted | corrupt-manifest bypasses guard |
| active rollback | `my-skill.json` survives | active skills protected |
| orphan rollback | `gone-skill.json` deleted | removed skill cleaned |

---

## Pitfalls seen in practice

1. **`touch -t` format differs** — Linux accepts `touch -t 202601010000`;
   macOS may need `touch -t 202601010000.00`. On Windows Git Bash, use
   PowerShell to backdate: `powershell -Command "(Get-Item '...').LastWriteTime = (Get-Date).AddDays(-2)"`.
2. **`mkdir -p` with brace expansion** — works in Bash; if your shell does
   not support `{exports,rollback}`, create each directory separately.
3. **`DSH_HOME` path format** — the CLI reads `DSH_HOME` as-is. On Windows
   Git Bash, use `cygpath -m` to get a Windows-style path the Node process
   can resolve.
4. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.
5. **Purge is irreversible** — `--yes` actually deletes. The dry-run default
   is deliberate; always review the dry-run output before passing `--yes`.
6. **Active skill rollback files** — `purge` checks the manifest's skill
   list. A rollback file whose name matches an active entry is always
   preserved, regardless of age.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **Failure injection on Windows** — simulating `rm` failure (e.g. file lock)
  requires holding an exclusive lock on the file while purge runs. The
  automated test suite (`test/purge.test.ts`) covers this path with `fs.open`
  file locks; manual reproduction is platform-specific and fragile.
- **Real GitHub network** — no network access needed; all artifacts are local.
- **DSH runtime integration** — purge is a pure filesystem operation; it does
  not interact with the DSH plugin or the panel.
- **Node 20 / 22 / 24 matrix** — CI (`.github/workflows/ci.yml`) runs the full
  quality gate set on push/PR.

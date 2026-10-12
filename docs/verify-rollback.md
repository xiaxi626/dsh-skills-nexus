# Verifying the `rollback` command

This guide verifies the **`rollback`** command — a single-use recovery that
restores the most recent branch update or switch-version:

- Each successful `update` or `switch-version` that changes the version
  identity (commit, branch, ref, or locked flag) saves a **rollback point** at
  `<NEXUS_HOME>/rollback/<name>.json`, anchored by a unique Git ref
  (`refs/nexus/rollback/<token>`) pointing at the old commit.
- `rollback <name>` reads the point, validates that the current HEAD, manifest
  and links still match the recorded "to" state, then checks out the old
  commit, restores links and manifest, and **consumes** the point (deletes the
  JSON). There is no redo — use `update` / `switch-version` to advance again.
- A dirty worktree triggers a warning and local changes are discarded.
- If the current state has drifted from the recovery point (manual git
  operations, another process), rollback **refuses** rather than silently
  overwriting.

> **Shell warning — Windows users: run the walkthrough in Git Bash (MINGW64),
> not PowerShell.** Every block below is POSIX / Bash. Do not paste it into a
> PowerShell terminal. Commands use `git -C <dir>` and never `cd` into your
> project, so your working tree cannot be polluted.

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
| `test/rollback.test.ts` | rollback point save / consume / validate; anchor ref creation; drift detection; dirty worktree discard; link collision refusal; failure recovery (restore checkout + frontmatter + links on late failure); JSON output |
| `test/version-recovery.test.ts` | update / switch-version late-failure restores exact branch, commit, frontmatter, links and manifest; recovery diagnostics preserved |
| `test/update.test.ts` | update creates rollback points on version change; dirty worktree does not block |
| `test/switch-version.test.ts` | switch-version creates rollback points; explicit lock cleared on success |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.

### Linux / macOS

```bash
# ---- upstream repo ----
UP=/tmp/nexus-rb-up
rm -rf "$UP" /tmp/nexus-rb
mkdir -p "$UP" && cd "$UP" && git init -b main
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# v1\n' > SKILL.md
git add . && git commit -m v1

# ---- isolated DSH_HOME ----
export DSH_HOME=/tmp/nexus-rb
PROJECT=~/dsh-skills-nexus                              # ← your path
cd "$PROJECT"

# ---- A) add skill on branch ----
node lib/cli/index.js add "file://$UP#main"
node lib/cli/index.js list                              # COMMIT = v1 SHA
V1=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)
echo "v1 = $V1"

# ---- B) push v2 upstream, update ----
cd "$UP"
printf -- '---\nname: demo\ndescription: v2\n---\n# v2\n' > SKILL.md
git add . && git commit -m v2
cd "$PROJECT"
node lib/cli/index.js update                            # ✓ xxxxxxx → yyyyyyy
V2=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)
echo "v2 = $V2"

# ---- C) verify rollback point exists ----
cat "$DSH_HOME/skills-nexus/rollback/up.json"
# Expected: JSON with "from" (v2 state) and "to" (v1 state), anchorRef

# ---- D) rollback to v1 ----
node lib/cli/index.js rollback up
# Expected: ✓ <v2-short> → <v1-short>
#           恢复点已消费；如需再次前进请使用 update/switch-version
node lib/cli/index.js list                              # COMMIT back to v1

# ---- E) rollback point consumed ----
ls "$DSH_HOME/skills-nexus/rollback/up.json" 2>/dev/null; echo "exit=$?"
# Expected: exit=2 (file not found — consumed)

# ---- F) second rollback refused ----
node lib/cli/index.js rollback up; echo "exit=$?"
# Expected: error: No rollback point for "up", exit=1

# ---- G) advance again with update ----
node lib/cli/index.js update                            # ✓ v1 → v2 again
# A new rollback point is created

# ---- H) --json output ----
node lib/cli/index.js rollback up --json
# Expected: JSON with "status":"rolled-back", fromCommit, toCommit

# ---- cleanup ----
rm -rf "$UP" /tmp/nexus-rb
unset DSH_HOME
```

### Windows (Git Bash / MINGW64)

```bash
# ---- upstream repo ----
UP="$(cygpath -m "$TEMP/nexus-rb-up")"
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb")"
mkdir -p "$UP" && cd "$UP" && git init -b main
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# v1\n' > SKILL.md
git add . && git commit -m v1

# ---- isolated DSH_HOME ----
export DSH_HOME="$(cygpath -m "$TEMP/nexus-rb")"
PROJECT=~/Downloads/dsh-skills-nexus                    # ← your path
cd "$PROJECT"

# ---- A) add skill on branch ----
node lib/cli/index.js add "file:///$UP#main"
node lib/cli/index.js list
V1=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)

# ---- B) push v2, update ----
cd "$UP"
printf -- '---\nname: demo\ndescription: v2\n---\n# v2\n' > SKILL.md
git add . && git commit -m v2
cd "$PROJECT"
node lib/cli/index.js update
V2=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)

# ---- C) rollback point exists ----
cat "$DSH_HOME/skills-nexus/rollback/up.json"

# ---- D) rollback ----
node lib/cli/index.js rollback up
node lib/cli/index.js list                              # COMMIT back to v1

# ---- E) consumed ----
ls "$DSH_HOME/skills-nexus/rollback/up.json" 2>/dev/null; echo "exit=$?"   # → exit=2

# ---- F) second rollback refused ----
node lib/cli/index.js rollback up; echo "exit=$?"               # → exit=1

# ---- G) advance again ----
node lib/cli/index.js update

# ---- H) --json ----
node lib/cli/index.js rollback up --json

# ---- cleanup ----
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb")"
unset DSH_HOME
```

---

## Part 3 — drift detection

Rollback refuses when the current state has drifted from the recorded "to"
state (e.g. manual git operations inside the clone).

### Linux / macOS

```bash
UP=/tmp/nexus-rb-drift
rm -rf "$UP" /tmp/nexus-rb-drift
mkdir -p "$UP" && cd "$UP" && git init -b main
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo\n---\n# v1\n' > SKILL.md
git add . && git commit -m v1

export DSH_HOME=/tmp/nexus-rb-drift
PROJECT=~/dsh-skills-nexus
cd "$PROJECT"

node lib/cli/index.js add "file://$UP#main"

# push v2 and update (creates rollback point)
cd "$UP"
printf -- '---\nname: demo\ndescription: v2\n---\n# v2\n' > SKILL.md
git add . && git commit -m v2
cd "$PROJECT"
node lib/cli/index.js update

# Manually drift: checkout a different commit
cd "$DSH_HOME/skills-nexus/repos/up"
git fetch --depth 1 origin main
git checkout FETCH_HEAD                   # drift away from expected state
cd "$PROJECT"

# Rollback should refuse
node lib/cli/index.js rollback up; echo "exit=$?"
# Expected: error: Rollback refused: current HEAD, manifest or links have drifted
# exit=1

rm -rf "$UP" /tmp/nexus-rb-drift
unset DSH_HOME
```

### Windows (Git Bash)

Same commands with path substitutions:

```bash
UP="$(cygpath -m "$TEMP/nexus-rb-drift")"
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb-drift")"
# ... same as above ...
export DSH_HOME="$(cygpath -m "$TEMP/nexus-rb-drift")"
# ... same commands ...
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb-drift")"
unset DSH_HOME
```

---

## Part 4 — dirty worktree warning

A dirty clone triggers a warning but does not block rollback.

```bash
# After step D above (before cleanup), or recreate:
# ... set up UP, DSH_HOME, add, push v2, update ...

# Dirty the clone
cd "$DSH_HOME/skills-nexus/repos/up"
printf 'local edit\n' >> SKILL.md
cd "$PROJECT"

node lib/cli/index.js rollback up
# Expected: ⚠ discarding local changes in nexus-managed clone
#           ✓ <v2-short> → <v1-short>
#           恢复点已消费
```

---

## What each step should print

| step | expected output | meaning |
|------|-----------------|---------|
| D: `rollback up` | `✓ abc1234 → def5678` + consumed message | restored to v1, point consumed |
| E: file check | `exit=2` (not found) | rollback JSON deleted |
| F: second rollback | `error: No rollback point for "up"`, exit=1 | single-use confirmed |
| G: `update` again | `✓ v1 → v2` | new rollback point created |
| H: `--json` | `{"version":1,"results":[{"status":"rolled-back",...}]}` | machine-readable |
| drift: manual checkout | `Rollback refused: current HEAD...drifted`, exit=1 | drift detection works |
| dirty: local edits | `⚠ discarding local changes…` + `✓ ...` | dirty warn + success |

---

## Pitfalls seen in practice

1. **The registered name is the repo slug, not "demo"** — `rollback demo`
   fails with `No skill named "demo"`. Use `list` to see the actual name
   (here `up`).
2. **Rollback is single-use by design.** After consuming the point, there is
   no redo. Use `update` or `switch-version` to advance again — each of those
   creates a new rollback point for the *next* rollback.
3. **Only version identity changes create rollback points.** A no-op update
   (branch pin already at latest) does not create a point — there is nothing
   to roll back to.
4. **Detached HEAD and locked entries** — rollback works for them too, as long
   as a rollback point exists (created by a prior `switch-version`).
5. **Drift detection is strict.** Any manual `git checkout`, `git fetch` +
   checkout, or external manifest edit inside the clone between the version
   change and the rollback will cause refusal. This is deliberate — rollback
   prefers to refuse than to silently overwrite.
6. **Link collision check** — if the old rollback's link names are now
   occupied by a different entry's links, rollback refuses with
   `link collision at "<name>"`. This prevents one rollback from clobbering
   another entry's symlinks.
7. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **Real GitHub network** — local `file://` remotes simulate the same git
  semantics without network flakiness.
- **DSH runtime integration** — rollback is a nexus-internal operation; it
  does not interact with the DSH plugin or the panel.
- **HTTP route** — there is no HTTP rollback route; the feature is CLI-only.
  The shared core (`rollbackEntry`) is available for future HTTP integration.
- **Node 20 / 22 / 24 matrix** — CI (`.github/workflows/ci.yml`) runs the full
  quality gate set on push/PR.

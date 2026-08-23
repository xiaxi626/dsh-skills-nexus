# Verifying the version-lock feature (P0)

This guide verifies the **version-lock ("lockfile-lite")** changes:

- `add` records the exact installed commit in `manifest.json` (new `commit`
  field) — `list` shows it as a short SHA.
- `update` dispatches by pin type: **branch pins fast-forward**, **tag/commit
  pins are fixed points** (verify only, never pull), and a pinned checkout that
  drifted is **restored automatically**.
- Re-adding an already-registered repo is **refused** without touching its
  clone.

Everything below is safe: nothing touches your real `~/.dsh`, no GitHub repo is
contacted, and the current repo is only read (or rebuilt via `npm run build`).
All temporary state lives under dedicated temp dirs you delete at the end.

## Prerequisites

- Node.js ≥ 18 and git on `PATH`
- Repo checked out and `npm install` done (tests run via `tsx` from `node_modules`)
- If you changed `src/`, run `npm run build` first — the walkthrough runs the
  compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: 98 tests, all passing
npm run build       # tsc → lib/
npm run test:build  # optional: compile src+test to test-dist/ for loader-free runs
```

The suite never touches your real environment: every test file uses a temp
`DSH_HOME` plus `mkdtemp` directories that `after()` hooks remove.

| test file | what it verifies |
|---|---|
| `test/add.test.ts` | `add` records the resolved commit; re-adding is refused and the clone stays intact |
| `test/update.test.ts` | branch pin fast-forwards and re-stamps the commit; tag pin is a fixed point; a drifted checkout is restored |
| `test/git.test.ts` | `getHeadCommit` / `isDetachedHead` / `resolveRefCommit` / `checkoutRef`; clone at a tag → detached HEAD, at a branch → symbolic HEAD |
| `test/manifest.test.ts` | `markUpdated` stamps `updatedAt` + `commit` |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.

### Windows (Git Bash / MINGW64)

```bash
# ---- upstream repo (simulates a GitHub skill repo) ----
UP="$(cygpath -m "$TEMP/up")"
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-demo")"      # clean slate
mkdir -p "$UP" && cd "$UP" && git init -b main        # git ≥2.28
git config user.email t@t && git config user.name t
printf '# demo\n---\nname: demo\ndescription: demo skill\n' > SKILL.md
git add . && git commit -m init && git tag v1.0.0

# ---- isolated DSH_HOME + the CLI ----
export DSH_HOME="$(cygpath -m "$TEMP/nexus-demo")"
PROJECT=~/Downloads/dsh-skills-nexus                  # ← your path
cd "$PROJECT"

# ---- A) tag pin = fixed point ----
node lib/cli/index.js add "file:///$UP#v1.0.0"
node lib/cli/index.js list                            # COMMIT column shows the SHA

cd "$UP" && printf '# demo v2\n---\nname: demo\ndescription: v2\n' > SKILL.md
git add . && git commit -m second                     # upstream moves forward
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ pinned at xxxxxxx — nothing to update
node lib/cli/index.js list        # COMMIT unchanged

# ---- B) branch pin = fast-forward ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file:///$UP#main"
node lib/cli/index.js list        # COMMIT = current main

cd "$UP" && printf '# demo v3\n---\nname: demo\ndescription: v3\n' > SKILL.md
git add . && git commit -m third
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ xxxxxxx → yyyyyyy
node lib/cli/index.js list        # COMMIT + UPDATED both refreshed

# ---- C) drift recovery ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file:///$UP#v1.0.0"
cd "$DSH_HOME/skills-nexus/skills/up"
git fetch --depth 1 origin main   # pull the newer commit into the shallow clone
git checkout FETCH_HEAD           # deliberately drift away from the pin
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ restored to pinned xxxxxxx
node lib/cli/index.js list        # COMMIT back to the pinned SHA

# ---- D) re-add guard ----
node lib/cli/index.js add "file:///$UP#v1.0.0"        # → refused, exit code 1
node lib/cli/index.js list        # clone still present and healthy

# ---- inspect the lock ----
cat "$DSH_HOME/skills-nexus/manifest.json"            # each entry has "commit"

# ---- cleanup ----
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-demo")"
```

### Linux / macOS

```bash
# ---- upstream repo (simulates a GitHub skill repo) ----
UP=/tmp/nexus-up
rm -rf "$UP" /tmp/nexus-demo                            # clean slate
mkdir -p "$UP" && cd "$UP" && git init -b main          # git ≥2.28; older: `git init && git symbolic-ref HEAD refs/heads/main`
git config user.email t@t && git config user.name t
printf '# demo\n---\nname: demo\ndescription: demo skill\n' > SKILL.md
git add . && git commit -m init && git tag v1.0.0

# ---- isolated DSH_HOME + the CLI ----
export DSH_HOME=/tmp/nexus-demo
PROJECT=~/dsh-skills-nexus                              # ← your path
cd "$PROJECT"

# ---- A) tag pin = fixed point ----
node lib/cli/index.js add "file://$UP#v1.0.0"
node lib/cli/index.js list                              # COMMIT column shows the SHA

cd "$UP" && printf '# demo v2\n---\nname: demo\ndescription: v2\n' > SKILL.md
git add . && git commit -m second                       # upstream moves forward
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ pinned at xxxxxxx — nothing to update
node lib/cli/index.js list        # COMMIT unchanged

# ---- B) branch pin = fast-forward ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file://$UP#main"
node lib/cli/index.js list        # COMMIT = current main

cd "$UP" && printf '# demo v3\n---\nname: demo\ndescription: v3\n' > SKILL.md
git add . && git commit -m third
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ xxxxxxx → yyyyyyy
node lib/cli/index.js list        # COMMIT + UPDATED both refreshed

# ---- C) drift recovery ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file://$UP#v1.0.0"
cd "$DSH_HOME/skills-nexus/skills/up"
git fetch --depth 1 origin main   # pull the newer commit into the shallow clone
git checkout FETCH_HEAD           # deliberately drift away from the pin
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ restored to pinned xxxxxxx
node lib/cli/index.js list        # COMMIT back to the pinned SHA

# ---- D) re-add guard ----
node lib/cli/index.js add "file://$UP#v1.0.0"          # → refused, exit code 1
node lib/cli/index.js list        # clone still present and healthy

# ---- inspect the lock ----
cat "$DSH_HOME/skills-nexus/manifest.json"             # each entry has "commit"

# ---- cleanup ----
rm -rf "$UP" /tmp/nexus-demo
```

---

## Part 3 — collection repos (`--subdir`)

A collection repo keeps its skills under subdirectories
(`skills/<name>/SKILL.md`, e.g. `trae-community/trae-skills`). Installing the
whole repo is rejected (root yields no installable skills) — use `--subdir` to
install one skill directory at a time.

### Linux / macOS

```bash
# upstream collection repo
COLL=/tmp/nexus-col
rm -rf "$COLL" /tmp/nexus-col-demo
mkdir -p "$COLL/skills/alpha" "$COLL/skills/beta"
printf -- '---\nname: alpha-skill\n---\nA\n' > "$COLL/skills/alpha/SKILL.md"
printf -- '---\nname: beta-skill\n---\nB\n' > "$COLL/skills/beta/SKILL.md"
printf '# docs\n' > "$COLL/README.zh-CN.md"          # root docs must NOT install
printf '# board\n' > "$COLL/community-leaderboard.md"
cd "$COLL" && git init -b main
git config user.email t@t && git config user.name t
git add . && git commit -m init

export DSH_HOME=/tmp/nexus-col-demo
cd "$PROJECT"

node lib/cli/index.js add "file://$COLL"                       # → rejected, hint suggests --subdir
node lib/cli/index.js add "file://$COLL" --subdir skills/alpha # → OK
node lib/cli/index.js list                                      # SUBDIR column = skills/alpha
node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"
# → only alpha-skill; README.zh-CN.md / community-leaderboard.md are not skills

rm -rf "$COLL" /tmp/nexus-col-demo
```

### Windows (Git Bash)

Same commands as above with these substitutions:

```bash
COLL="$(cygpath -m "$TEMP/collection")"
rm -rf "$COLL" "$(cygpath -m "$TEMP/nexus-col-demo")"
# ... create the repo exactly as above ...
export DSH_HOME="$(cygpath -m "$TEMP/nexus-col-demo")"
# ... same add/list/resolve commands, cleanup with:
rm -rf "$COLL" "$(cygpath -m "$TEMP/nexus-col-demo")"
```

---

## What each step should print

| step | expected output | meaning |
|---|---|---|
| A: `update` on a tag pin | `✓ pinned at xxxxxxx — nothing to update` | fixed point: upstream moved, the clone did not |
| B: `update` on a branch pin | `✓ xxxxxxx → yyyyyyy` (or `up to date`) | fast-forwarded and the lock re-stamped |
| C: `update` after drift | `✓ restored to pinned xxxxxxx` | drifted checkout detected and checked back out |
| D: re-`add` | refusal message, exit code 1 | guard works; existing clone untouched |
| `manifest.json` | `"commit": "<40-char SHA>"` per entry | the lock itself |

---

## Pitfalls seen in practice

1. **The registered name is the repo slug, not "demo"** — `remove demo` fails
   with `No skill named "demo"`. The name is the last segment of the repo URL
   (here `up`); use `node lib/cli/index.js list` to see it.
2. **Re-adding a registered repo is refused — that is the guard, not a bug.**
   `remove` first, or `update` to refresh instead.
3. **Shallow clones only contain the pinned commit.** `git checkout 118eecf`
   fails with `pathspec '118eecf' did not match` because that object is not in
   the `--depth 1` clone. To simulate drift, `git fetch --depth 1 origin main`
   first, then `git checkout FETCH_HEAD`.
4. **Stale `$DSH_HOME`** — a previous run leaves registered entries, so `add`
   reports "already registered". Delete the temp `DSH_HOME` (see cleanup) before
   starting fresh.
5. **One repo = one entry.** The same repo cannot be registered twice (path
   uniqueness), even under different `--name`s. Remove first.
6. **Git needs a user identity** in the upstream repo — set
   `user.email` / `user.name` before committing.
7. **Platform path formats.** Windows Git Bash: convert with `cygpath -m` and
   use `file:///C:/...` URLs. Linux / macOS: plain absolute paths (`/tmp/...`)
   and `file:///tmp/...` URLs.
8. **`git init -b main` needs git ≥ 2.28** (2019). Older git: `git init &&
   git symbolic-ref HEAD refs/heads/main`.
9. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **Real GitHub network** — local `file://` remotes simulate the same git
  semantics without network flakiness.
- **DSH runtime integration** — the provider's `list()` / `get()` are unchanged;
  the new manifest field is backward compatible (old manifests without
  `commit` still load, showing `—` until the next `update`).
- **Node 18 / 20 / 22 matrix** — CI (`.github/workflows/ci.yml`) runs the full
  quality gate set on push/PR.

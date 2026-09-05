# Verifying the clone-retry feature (P0)

This guide verifies the **exponential-backoff retry in `cloneRepo`** (weak-network robustness):

- `src/git.ts` adds a generic `retry(fn, { retries, minDelay })`: on failure it backs off exponentially as `minDelay * 2^attempt`, and is **exported** for tests and observation.
- `cloneRepo` wraps **branch / tag** clones only in `retry({ retries: 1, minDelay: 500 })` (2 attempts total, one 500ms wait in between) — one more chance under network jitter.
- **A commit-SHA pin is NOT retried**: `git clone --branch <40-char SHA>` fails deterministically (always `exit=128`), so retrying only wastes time; it still uses the original `clone + fetch + checkout` fallback (behaviour unchanged).
- **Zero impact on a normal clone**: the first success `return`s immediately — it never enters the catch, never calls `setTimeout`, never runs a second loop; the successful path's git commands / args / result are byte-for-byte identical to before. There is **no timeout**, so a large repo / slow network is never killed by mistake.

Everything below is safe: nothing touches your real `~/.dsh`, no real GitHub repo is contacted, and the current project repo is only read (or rebuilt via `npm run build`). All temporary state lives under dedicated temp dirs you delete at the end.

> **⚠️ Shell warning (read this first)**
>
> - **Windows users: every command block in this guide is Git Bash (MINGW64) / bash syntax — run it in Git Bash.**
> - **Do NOT paste these blocks into PowerShell or cmd**: `VAR=...`, `cygpath`, `printf`, `&&`, `rm -rf`, `$(...)` behave differently or error out under PowerShell. The classic accident is — pasting a PowerShell block (`Push-Location` / `New-Item` / `Remove-Item`) into Git Bash, where every cmdlet is `command not found` and `Push-Location` **silently fails to change directory**, so the following `git init` / `config` / `commit` / `tag` land in your **current project repo** — creating a commit and a tag out of thin air and overwriting your git identity.
> - This guide structurally prevents that accident: in Part 3 every git command that builds the upstream repo uses `git -C "$UP"` to **target the temp dir explicitly** and contains **no `cd` at all**, so even if you paste it line-by-line while sitting in the project directory, it can never re-init, change identity, commit, or tag the current project.

## Prerequisites

- Node.js ≥ 18 and git on `PATH`
- Repo checked out and `npm install` done (tests run via `tsx` from `node_modules`)
- If you changed `src/`, run `npm run build` first — the walkthrough runs the compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: all tests pass
npm run build       # tsc → lib/
npm run test:build  # optional: compile src+test to test-dist/ for loader-free runs
```

The suite never touches your real environment: every test file uses a temp `DSH_HOME` plus `mkdtemp` directories that `after()` hooks remove.

This change adds 4 tests (+4 over before), all in `test/git.test.ts`:

| test | what it verifies |
|---|---|
| `retry returns result on first success` | first call succeeds → invoked once, no backoff |
| `retry exhausts attempts then throws` | always fails → invoked `retries+1` times, then throws the last error |
| `retry succeeds on second attempt` | fails once, succeeds next → invoked twice, then returns |
| `cloneRepo at a raw commit SHA falls back to clone+fetch+checkout` | a commit-SHA pin uses the fallback and ends detached-HEAD (locked in before the refactor to prove "no retry" does not break that path) |

---

## Part 2 — observe exponential backoff directly (cross-platform, zero side effects)

Calls the exported `retry` purely in memory and prints each attempt's relative timestamp. **Touches no filesystem, no git, no network, no repo state** — it only `import`s the read-only `lib/git.js`. Run it from the **project root** (the dir containing `lib/`):

```bash
node --input-type=module -e "import {retry} from './lib/git.js'; let n=0; const t0=Date.now(); const r=await retry(async()=>{n++; console.log('attempt '+n+' @+'+(Date.now()-t0)+'ms'); if(n<3) throw new Error('flaky'); return 'recovered';},{retries:3,minDelay:200}); console.log('result='+r+' total_calls='+n);"
```

Expected output (backoff gaps ≈ `minDelay * 2^attempt` = 200ms, 400ms; cumulative ≈ 200ms, ≈ 600ms, with tens of ms of jitter):

```
attempt 1 @+0ms
attempt 2 @+2xx ms        # waits ~200ms after the first failure
attempt 3 @+6xx ms        # waits ~400ms after the second failure (cumulative ~600ms)
result=recovered total_calls=3
```

Meaning: the first two calls throw and trigger backoff retries, the third succeeds and returns, for 3 calls total. This single command proves both **the exponential-backoff timing** and **stop-on-success** (no extra calls). It is also this guide's **deterministic way** to observe that "a retry really fires" — real network jitter cannot be reproduced on demand, so this pure function call locks in the backoff behaviour.

---

## Part 3 — end-to-end regression: all three pin types still clone

Goal: prove that after wrapping `cloneRepo` in `retry`, the normal clone path for **branch / tag / commit-SHA** pins has zero regression.

> Note: a local `file://` clone never "transiently fails", so this part does **not trigger a retry**; the retry firing is observed deterministically in Part 2 via `node -e`. This part verifies "the refactor did not break the normal path".

Safety design (restated): every git command that builds the upstream repo uses `git -C "$UP"` with **no `cd` anywhere**; the CLI only **reads** `lib/` in the project directory, and all writes land in the temp `DSH_HOME`.

### Windows (Git Bash / MINGW64)

```bash
# ---- upstream repo (isolated in a temp dir; git -C targets it explicitly, no cd, safe to paste line-by-line) ----
UP="$(cygpath -m "$TEMP/retry-up")"
DEMO="$(cygpath -m "$TEMP/retry-demo")"
rm -rf "$UP" "$DEMO"                                  # clean slate
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥2.28; explicit -C, no cd needed
git -C "$UP" config user.email t@t                    # writes only the temp repo's local config
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"   # absolute-path write; complete frontmatter → clone is not dirtied by normalization
git -C "$UP" add -A && git -C "$UP" commit -m init && git -C "$UP" tag v1.0.0

# ---- isolated DSH_HOME + run the CLI from the project dir ----
export DSH_HOME="$DEMO"
PROJECT=~/Downloads/dsh-skills-nexus                  # ← your path
cd "$PROJECT"

# A) branch pin: cloneRepo takes the retry-wrapped --branch path
node lib/cli/index.js add "file:///$UP#main"
node lib/cli/index.js list                            # COMMIT = current main SHA

# B) tag pin: --branch <tag> also takes the retry path; detached HEAD after clone
node lib/cli/index.js remove retry-up                 # registered name = repo dir name (last URL segment)
node lib/cli/index.js add "file:///$UP#v1.0.0"
node lib/cli/index.js list

# C) commit-SHA pin: no retry; after --branch <sha> fails deterministically it uses the clone+fetch+checkout fallback
node lib/cli/index.js remove retry-up
SHA=$(git -C "$UP" rev-parse HEAD)
node lib/cli/index.js add "file:///$UP#$SHA"
node lib/cli/index.js list                            # COMMIT = $SHA, detached HEAD

# D) why a commit-SHA is not retried — observe that deterministic failure directly (clones into a temp dir, then deletes it)
PROBE="$(cygpath -m "$TEMP/retry-sha-probe")"
rm -rf "$PROBE"
git clone --branch "$SHA" "file:///$UP" "$PROBE"; echo "exit=$?"   # → Remote branch <sha> not found … exit=128
rm -rf "$PROBE"

# ---- inspect the lock ----
cat "$DSH_HOME/skills-nexus/manifest.json"            # each entry has "commit"

# ---- cleanup (delete temp dirs + unset DSH_HOME; never touches the project) ----
rm -rf "$UP" "$DEMO"
unset DSH_HOME
```

### Linux / macOS

```bash
# ---- upstream repo (git -C targets it explicitly, no cd) ----
UP=/tmp/retry-up
DEMO=/tmp/retry-demo
rm -rf "$UP" "$DEMO"
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥2.28; older: git init && git -C "$UP" symbolic-ref HEAD refs/heads/main
git -C "$UP" config user.email t@t
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"
git -C "$UP" add -A && git -C "$UP" commit -m init && git -C "$UP" tag v1.0.0

# ---- isolated DSH_HOME + the CLI ----
export DSH_HOME="$DEMO"
PROJECT=~/dsh-skills-nexus                            # ← your path
cd "$PROJECT"

node lib/cli/index.js add "file://$UP#main"           # A) branch pin
node lib/cli/index.js list

node lib/cli/index.js remove retry-up                 # B) tag pin
node lib/cli/index.js add "file://$UP#v1.0.0"
node lib/cli/index.js list

node lib/cli/index.js remove retry-up                 # C) commit-SHA pin
SHA=$(git -C "$UP" rev-parse HEAD)
node lib/cli/index.js add "file://$UP#$SHA"
node lib/cli/index.js list

PROBE=/tmp/retry-sha-probe                            # D) deterministic-failure probe
rm -rf "$PROBE"
git clone --branch "$SHA" "file://$UP" "$PROBE"; echo "exit=$?"
rm -rf "$PROBE"

cat "$DSH_HOME/skills-nexus/manifest.json"

rm -rf "$UP" "$DEMO"
unset DSH_HOME
```

---

## What each step should print

| step | expected output | meaning |
|---|---|---|
| Part 2: `node -e` backoff | `attempt 1 @+0ms` / `attempt 2 @+2xx ms` / `attempt 3 @+6xx ms` / `total_calls=3` | exponential-backoff timing is correct and it stops on success |
| Part 3 A: branch-pin `add` | `Added skill "retry-up" …`, `list` COMMIT = main SHA | the retry-wrapped `--branch` path works |
| Part 3 B: tag-pin `add` | `list` COMMIT = the SHA v1.0.0 points at (single-commit repo, same as A) | the `--branch <tag>` path works; detached HEAD after clone |
| Part 3 C: commit-SHA-pin `add` | `list` COMMIT = `$SHA` | no retry; the clone+fetch+checkout fallback succeeds |
| Part 3 D: `git clone --branch <sha>` | `fatal: Remote branch <sha> not found …` + `exit=128` | a commit-SHA is a deterministic failure — exactly why it must not be retried |
| `manifest.json` | `"commit": "<40-char SHA>"` per entry | the version lock itself (orthogonal to clone-retry; a sanity check that it is intact) |

---

## Pitfalls seen in practice

1. **Do not mix shells.** The blocks here are bash syntax; on Windows run them in **Git Bash**. Pasting a PowerShell block into bash (or vice versa) makes directory switches like `Push-Location` / `cd` **fail silently**, so the following `git init` / `config` / `commit` / `tag` land in the current directory — if that is your project repo, you create a commit and a tag out of thin air and overwrite your git identity. This doc avoids that structurally with `git -C "$UP"` + no `cd`.
2. **How to rescue the project repo if it really got hit?** If nothing was pushed yet: `git tag -d <the stray tag>`; `git reset --hard <the correct commit>` (e.g. the SHA matching `origin/master`); `git config --local user.name` / `user.email` back to your own identity. `git reflog` helps you recover commits dropped by the reset. **Never** run delete commands inside the real project beyond Part 3's cleanup block.
3. **The registered name is the last segment of the repo URL** — here `retry-up` (not `demo` from the frontmatter). When unsure, run `node lib/cli/index.js list` first.
4. **One repo = one entry.** To change ref, `remove retry-up` first, then `add` (that is what A→B→C here do).
5. **The commit-SHA fallback relies on `git fetch origin <sha>`.** This guide's upstream repo has a **single commit**, so `$SHA` is HEAD and the object is already local after the shallow clone — the fallback always succeeds. If your upstream had multiple commits and `$SHA` pointed at an older one, the server would need `uploadpack.allowReachableSHA1InWant` to fetch by SHA — this does not affect the guide (single commit).
6. **Platform path formats.** Windows Git Bash: convert with `cygpath -m` and use `file:///C:/...` URLs. Linux / macOS: plain absolute paths (`/tmp/...`) and `file:///tmp/...` URLs.
7. **`git -C` needs git ≥ 1.8.5** (2013, almost certainly satisfied); `git init -b main` needs git ≥ 2.28 (2019). Older git: `git init && git -C "$UP" symbolic-ref HEAD refs/heads/main`.
8. **Run the compiled CLI** — Parts 2 and 3 both use `lib/`; after changing `src/`, rebuild with `npm run build` first.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **Real GitHub network jitter** — a local `file://` remote uses the same git semantics as a real remote but never transiently fails. The retry **firing** is observed deterministically via Part 2's `node -e` pure-function call; whether `cloneRepo` wraps `retry` around the branch/tag clone is a single line you can read directly in `src/git.ts` (`retry(branchClone, { retries: 1, minDelay: 500 })`).
- **Injecting a real git failure end-to-end to observe the second attempt** — not done locally. On Windows, Node's `execFile('git', …)` refuses / bypasses `.cmd` / `.bat` wrappers (the CVE-2024-27980 mitigation), so a "fake git earlier in PATH" cannot intercept and count; on Linux / macOS a shell wrapper would work, but the payoff over Part 2 is limited and it introduces an extra temp executable, so it is left out.
- **Timeout** — this round **does not** add a timeout: a timeout would kill a "normal but slow" clone before it fails, possibly harming large repos; and other network calls like `getDefaultBranch` (`ls-remote`) are not covered anyway. Moved out of this round per YAGNI.
- **DSH runtime integration / the Node 20-22-24 matrix** — see `verify-version-lock` and CI (`.github/workflows/ci.yml`).

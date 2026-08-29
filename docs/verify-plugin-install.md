# Verifying the plugin-load contract (plugin add → dsh web cold boot)

This guide verifies the **plugin-load contract**:

- **A. Install registration** — after `dsh plugin --profile <name> add` installs
  this package, reconcile reads the `dsh.bundle.patch: cordis.patch.yml`
  declaration in `package.json` and appends the package to the profile's
  `dsh.profile.bundles` layer.
- **B. Cold-boot loading** — at `dsh web` startup, the `insert` entry in
  `cordis.patch.yml` is handed to the cordis loader as a **bare package name**;
  Node module resolution hits the package in the profile's `node_modules`, and
  `main` / `exports["."]` load `lib/index.js`.

The contract has two parts, both required:

1. the `cordis.patch.yml` entry must be a **bare package name**
   (`'dsh-skills-nexus'`) — a relative path is anchored at the profile root and
   points at the structurally nonexistent `<profile>/lib/index.js`;
2. `package.json` must have `main` and `exports["."]` pointing at
   `lib/index.js`.

Break either one and `dsh web` cold boot fails with `ERR_MODULE_NOT_FOUND` and a
whole-tree load failure. The entry's `apply()` is a no-op (skill discovery goes
through symlinks + the official filesystem provider), so an unloaded plugin has
no functional symptom — a full-tree crash is the only signal, which is why any
change touching the contract must re-run this guide.

## Relation to your real `~/.dsh` (read first)

- **This walkthrough writes to your real `~/.dsh/profiles/web/`** (install,
  boot, remove). A temp `DSH_HOME` cannot substitute: the very thing under test
  is the real profile's load path.
- **No GitHub access, no links created**: before the fix is pushed, a local
  `file:` source stands in for the `github:` spec; the walkthrough never calls
  `dsh-skills-nexus add`, so no link creation of any kind is involved.
- The cleanup step restores the profile to its original state (base bundles
  only).

## Prerequisites

- Node.js ≥ 20 (per `engines` in `package.json`), `npx` available, npm registry
  reachable
- This repo checked out; if you changed `src/`, run `npm run build` first (the
  loaded entry is the compiled `lib/` output)
- A `web` profile exists on this machine (running `dsh web` once initializes it)

---

## Part 1 — quality gates (static contract checks)

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: all tests pass
npm run build       # tsc → lib/
```

Three static contract checks (any miss is a regression):

```bash
grep -n "name:" cordis.patch.yml      # expected: name: 'dsh-skills-nexus' — bare name, no './' prefix
grep -n '"main":' package.json        # expected: "main": "lib/index.js"
grep -n '"\.":' package.json          # expected: exports contains ".": "./lib/index.js"
```

---

## Part 2 — end-to-end walkthrough (local source stands in for GitHub)

Before the fix is pushed, the remote commit may still carry the broken contract,
so a `github:` install would only reproduce the crash. Use the local workspace
as the package source instead. **Everything after `file:` is identical to a real
`github:` install**: pnpm materializes into the profile's `node_modules` →
reconcile registers the bundle → cold boot resolves it.

One copy-paste block per platform. Replace `PROJECT` with your checkout path.

### Windows (Git Bash / MINGW64)

```bash
PROJECT="$(cygpath -m ~/Downloads/dsh-skills-nexus)"   # ← your path (forward slashes)
cd "$PROJECT"

echo "--- [a] install the local package ---"
npx @deepseek-ai/dsh plugin --profile web add "file:$PROJECT"; echo "exit=$?"

echo "--- [b] confirm registration in the bundles layer ---"
cat ~/.dsh/profiles/web/package.json
# expected: dsh.profile.bundles contains "dsh-skills-nexus"; dependencies has the file: entry

echo "--- [c] cold boot (the original crash point) ---"
npx @deepseek-ai/dsh web --no-open
# expected: prints "dsh web: http://127.0.0.1:3080", no loader errors, process stays up
```

In a second Git Bash window:

```bash
echo "--- [d] service is listening ---"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080   # expected: 200
```

Back in the [c] window, `Ctrl+C` to stop the service, then clean up:

```bash
echo "--- [e] cleanup: remove the plugin ---"
npx @deepseek-ai/dsh plugin --profile web remove dsh-skills-nexus; echo "exit=$?"
cat ~/.dsh/profiles/web/package.json
# expected: bundles back to base entries; dsh-skills-nexus gone from dependencies
```

### macOS / Linux

```bash
PROJECT="$(pwd)"          # ← run from the repo root; or use an absolute path
cd "$PROJECT"

echo "--- [a] install the local package ---"
npx @deepseek-ai/dsh plugin --profile web add "file:$PROJECT"; echo "exit=$?"

echo "--- [b] confirm registration in the bundles layer ---"
cat ~/.dsh/profiles/web/package.json

echo "--- [c] cold boot (the original crash point) ---"
npx @deepseek-ai/dsh web --no-open
# expected: same as Windows; keep it running, run [d] in another terminal:
#   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080   # expected: 200
# then Ctrl+C in the [c] window:

echo "--- [e] cleanup: remove the plugin ---"
npx @deepseek-ai/dsh plugin --profile web remove dsh-skills-nexus; echo "exit=$?"
cat ~/.dsh/profiles/web/package.json
```

---

## Pass criteria

| step | pass | failure signal |
|---|---|---|
| [a] | `exit=0`, pnpm install succeeds | pnpm error / reconcile warning `declares no dsh.bundle` |
| [b] | bundles contain `dsh-skills-nexus` | missing (the `dsh.bundle.patch` declaration is broken) |
| [c] | prints the listen address, stays up without errors | `failed to import loader entry dsh-skills-nexus` / `ERR_MODULE_NOT_FOUND` / process exits |
| [d] | HTTP 200 | connection refused |
| [e] | `exit=0`, profile restored | leftover dependency or bundle |

Boot crashes happen early in tree composition — ~10 clean seconds at [c] is a
pass.

---

## Real `github:` re-verification after the fix is pushed

Once the fix commit is pushed, swap [a] for the real spec and re-run [b]–[e] to
cover the tarball-fetch step:

```bash
npx @deepseek-ai/dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"
```

If you then go on to verify skill functionality (`dsh-skills-nexus add`, etc.),
see the other two `verify-*` walkthroughs — that is outside this contract.

---

## Design notes

- **Why not drop the bundle declaration and ship a plain CLI package?** Keeping
  `dsh.bundle` preserves the package's profile-layer identity (reconcile emits
  no `declares no dsh.bundle` warning) and leaves the door open for future
  runtime integration; the no-op `apply()` makes loading side-effect-free.
- **Maintenance rule**: any change touching `cordis.patch.yml`, `main`,
  `exports`, or `dsh.bundle` must re-run this guide.

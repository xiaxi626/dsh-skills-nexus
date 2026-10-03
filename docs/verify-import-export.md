# Verifying export / import / adopt

This guide verifies the **package channels** (channel C and D of
[sources-and-packages.md](sources-and-packages.md)):

- **`export`** — package one or more entries into a zip with a
  `nexus-package.json` label carrying source metadata.
- **`import`** — rebuild entries from a package, preferring git re-clone when
  the label's url is reachable, falling back to snapshot.
- **`adopt`** — give a frozen (no-git-source) entry a real git identity so it
  becomes updatable.

Everything below is safe: nothing touches your real `~/.dsh`, no GitHub repo
is contacted, and the current repo is only read (or rebuilt via
`npm run build`). All temporary state lives under dedicated temp dirs you
delete at the end.

## Prerequisites

- Node.js >= 18 and git on `PATH`
- Repo checked out and `npm install` done
- If you changed `src/`, run `npm run build` first — the walkthrough runs the
  compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: all tests pass
npm run build       # tsc -> lib/
```

Relevant test coverage:

| test file | what it verifies |
|---|---|
| `test/export.test.ts` | label structure, payload (no `.git`), PKZip round trip, `ownership: 'external'` boundary, `--all` includes disabled, CLI surface |
| `test/import.test.ts` | label-driven git restore vs snapshot fallback, peel scan (candidate root discovery), four-state reachability, `--dry-run` plan, `--each` / `--subdir` scope, state restoration (enabled/links), bare package handling, error grading (`no-skill-found` / `skill-nested-too-deep`) |
| `test/adopt.test.ts` | seven-step sequence, skill-set comparison, backup/restore, link rebuild, `--force` re-source, `--prune`, failure rollback (byte-level manifest/link/directory restoration), external entry refusal |
| `test/zip.test.ts` | PKZip codec: round trip, zip-slip rejection, `.git` skip, size/entry limits, encryption rejection |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.
Steps `[a]`–`[i]` cover the full behavior surface.

### Windows (Git Bash / MINGW64)

```bash
# ---- setup: two fake remote repos + one skill each ----
REPO_A="$(cygpath -m "$TEMP/nexus-vr/repo-a")"
REPO_B="$(cygpath -m "$TEMP/nexus-vr/repo-b")"
DEMO="$(cygpath -m "$TEMP/nexus-vr-demo")"
rm -rf "$TEMP/nexus-vr" "$DEMO"
mkdir -p "$REPO_A" "$REPO_B"
printf -- '---\nname: alpha-skill\ndescription: Alpha\n---\nAlpha body\n' > "$REPO_A/SKILL.md"
printf -- '---\nname: beta-skill\ndescription: Beta\n---\nBeta body\n' > "$REPO_B/SKILL.md"
cd "$REPO_A" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init
cd "$REPO_B" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/Downloads/dsh-skills-nexus                  # <- your path
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] add two entries ---"
node lib/cli/index.js add "file:///$REPO_A"
node lib/cli/index.js add "file:///$REPO_B"
node lib/cli/index.js list
# expected: alpha-skill and beta-skill both listed, both on

echo "--- [b] disable beta, then export --all ---"
node lib/cli/index.js disable beta
node lib/cli/index.js export --all -o "$DEMO/migrate.zip"
# expected: "2 entries, N files -> migrate.zip (zip)"

echo "--- [c] inspect the package label ---"
cd "$DEMO" && mkdir -p inspect && cd inspect
unzip -o ../migrate.zip nexus-package.json >/dev/null 2>&1
cat nexus-package.json
# expected: two entries; alpha enabled=true, beta enabled=false;
# both have gitUrl pointing at file:///... remotes
cd "$PROJECT"

echo "--- [d] import into a fresh DSH_HOME (cross-machine simulation) ---"
DEMO2="$(cygpath -m "$TEMP/nexus-vr-demo2")"
rm -rf "$DEMO2"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/migrate.zip" --dry-run
# expected: two candidates, both "will clone from file:///... (main)"
node lib/cli/index.js import "$DEMO/migrate.zip"
node lib/cli/index.js list
# expected: alpha-skill on, beta-skill off (state restored from label)

echo "--- [e] verify the imported entries are updatable ---"
node lib/cli/index.js update alpha
# expected: update succeeds (git source restored from label)

echo "--- [f] bare package (no label) -> snapshot ---"
BARE="$(cygpath -m "$TEMP/nexus-bare")"
rm -rf "$BARE"; mkdir -p "$BARE"
printf -- '---\nname: gamma-skill\ndescription: Gamma\n---\nGamma body\n' > "$BARE/SKILL.md"
cd "$BARE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm bare
cd "$PROJECT"
# make a zip without a nexus-package.json label
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$BARE', 'SKILL.md'));
const arch = createZip([{ name: 'SKILL.md', data }]);
fs.writeFileSync('$DEMO/bare.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/bare.zip" --dry-run
# expected: "manifest: none (source unknown)", "will import as snapshot (source unknown)"
node lib/cli/index.js import "$DEMO/bare.zip"
node lib/cli/index.js list | grep gamma
# expected: gamma-skill listed, no git source (cannot update)
node lib/cli/index.js update gamma; echo "exit=$?"
# expected: exit=1, "has no git source"

echo "--- [g] adopt the snapshot -> updatable ---"
node lib/cli/index.js adopt gamma --url "file:///$BARE"
node lib/cli/index.js list | grep gamma
# expected: gamma-skill now has a git source, updatable
node lib/cli/index.js update gamma; echo "exit=$?"
# expected: exit=0, update succeeds

echo "--- [h] error grading: nested too deep ---"
DEEP="$(cygpath -m "$TEMP/nexus-deep")"
rm -rf "$DEEP"; mkdir -p "$DEEP/w1/w2/w3/w4"
printf -- '---\nname: deep-skill\ndescription: Deep\n---\nD\n' > "$DEEP/w1/w2/w3/w4/SKILL.md"
cd "$DEEP" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm deep
cd "$PROJECT"
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$DEEP', 'w1/w2/w3/w4/SKILL.md'));
const arch = createZip([{ name: 'w1/w2/w3/w4/SKILL.md', data }]);
fs.writeFileSync('$DEMO/deep.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/deep.zip" --dry-run; echo "exit=$?"
# expected: exit=1, "skill-nested-too-deep" with location and depth

echo "--- [i] cleanup ---"
rm -rf "$TEMP/nexus-vr" "$DEMO" "$DEMO2" "$BARE" "$DEEP"
unset DSH_HOME
```

### Linux / macOS

Same commands with plain absolute paths (no `cygpath`):

```bash
# ---- setup ----
REPO_A=/tmp/nexus-vr/repo-a
REPO_B=/tmp/nexus-vr/repo-b
DEMO=/tmp/nexus-vr-demo
rm -rf /tmp/nexus-vr "$DEMO"
mkdir -p "$REPO_A" "$REPO_B"
printf -- '---\nname: alpha-skill\ndescription: Alpha\n---\nAlpha body\n' > "$REPO_A/SKILL.md"
printf -- '---\nname: beta-skill\ndescription: Beta\n---\nBeta body\n' > "$REPO_B/SKILL.md"
cd "$REPO_A" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init
cd "$REPO_B" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/dsh-skills-nexus                            # <- your path
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] add two entries ---"
node lib/cli/index.js add "file://$REPO_A"
node lib/cli/index.js add "file://$REPO_B"
node lib/cli/index.js list

echo "--- [b] disable beta, then export --all ---"
node lib/cli/index.js disable beta
node lib/cli/index.js export --all -o "$DEMO/migrate.zip"

echo "--- [c] inspect the package label ---"
cd "$DEMO" && mkdir -p inspect && cd inspect
unzip -o ../migrate.zip nexus-package.json >/dev/null 2>&1
cat nexus-package.json
cd "$PROJECT"

echo "--- [d] import into a fresh DSH_HOME ---"
DEMO2=/tmp/nexus-vr-demo2
rm -rf "$DEMO2"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/migrate.zip" --dry-run
node lib/cli/index.js import "$DEMO/migrate.zip"
node lib/cli/index.js list
# expected: alpha-skill on, beta-skill off

echo "--- [e] verify imported entries are updatable ---"
node lib/cli/index.js update alpha

echo "--- [f] bare package -> snapshot ---"
BARE=/tmp/nexus-bare
rm -rf "$BARE"; mkdir -p "$BARE"
printf -- '---\nname: gamma-skill\ndescription: Gamma\n---\nGamma body\n' > "$BARE/SKILL.md"
cd "$BARE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm bare
cd "$PROJECT"
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$BARE', 'SKILL.md'));
const arch = createZip([{ name: 'SKILL.md', data }]);
fs.writeFileSync('$DEMO/bare.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/bare.zip" --dry-run
node lib/cli/index.js import "$DEMO/bare.zip"
node lib/cli/index.js list | grep gamma
node lib/cli/index.js update gamma; echo "exit=$?"

echo "--- [g] adopt the snapshot -> updatable ---"
node lib/cli/index.js adopt gamma --url "file://$BARE"
node lib/cli/index.js list | grep gamma
node lib/cli/index.js update gamma; echo "exit=$?"

echo "--- [h] error grading: nested too deep ---"
DEEP=/tmp/nexus-deep
rm -rf "$DEEP"; mkdir -p "$DEEP/w1/w2/w3/w4"
printf -- '---\nname: deep-skill\ndescription: Deep\n---\nD\n' > "$DEEP/w1/w2/w3/w4/SKILL.md"
cd "$DEEP" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm deep
cd "$PROJECT"
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$DEEP', 'w1/w2/w3/w4/SKILL.md'));
const arch = createZip([{ name: 'w1/w2/w3/w4/SKILL.md', data }]);
fs.writeFileSync('$DEMO/deep.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/deep.zip" --dry-run; echo "exit=$?"

echo "--- [i] cleanup ---"
rm -rf /tmp/nexus-vr "$DEMO" "$DEMO2" "$BARE" "$DEEP"
unset DSH_HOME
```

---

## What each step should print

| step | expected output | meaning |
|---|---|---|
| `[a]` add | `Added skill "alpha-skill"` / `"beta-skill"`, list shows both on | two independent git entries |
| `[b]` export | `2 entries, N files -> migrate.zip (zip)` | package includes disabled entries |
| `[c]` label | JSON with two entries; alpha `enabled: true`, beta `enabled: false`; both have `gitUrl` | label records source + state |
| `[d]` import | `--dry-run`: two `will clone from file:///... (main)` lines; real import: alpha on, beta off | git restore + state restoration |
| `[e]` update | `update` succeeds on imported entry | source was restored from label |
| `[f]` bare import | `--dry-run`: `manifest: none (source unknown)`, `will import as snapshot`; `update gamma` exits 1 | snapshot has no git source |
| `[g]` adopt | `Attached file:///... (main, <sha>) to "gamma"`; `update gamma` exits 0 | frozen entry became updatable |
| `[h]` nested | `skill-nested-too-deep` with depth and location, exit 1 | error grading distinguishes depth from absence |

---

## Pitfalls seen in practice

1. **Same `$DSH_HOME` accumulates entries** — steps `[a]`–`[h]` share demo
   environments; later `list` outputs include earlier entries. Assert per-name,
   not total counts.
2. **`file://` remotes and sparse warnings** — local remotes have
   `uploadpack.allowFilter` off by default, so git downloads objects anyway.
   The clone still works; you may see a `the remote ignored the blob filter`
   warning. Not an error.
3. **Platform paths** — Windows Git Bash: `cygpath -m` + `file:///C:/...`;
   Linux / macOS: plain absolute paths + `file:///tmp/...`.
4. **`git init -b main` needs git >= 2.28** — older git: `git init &&
   git symbolic-ref HEAD refs/heads/main`.
5. **Run the compiled CLI** — the walkthrough uses `lib/`; rebuild with
   `npm run build` after changing `src/`.
6. **`node -e` for bare zip creation** — the walkthrough uses inline Node to
   create a zip without a label (simulating a third-party package). This is
   just for test setup; real packages come from `export` or other tools.

---

## Coverage boundaries

- **Real GitHub network** — local `file://` remotes simulate the same git
  semantics without network flakiness. A real run against a GitHub repo
  should behave identically.
- **Panel import UI** — the panel's file picker + preview + confirm flow is
  covered by `test/panel-render.test.ts`; this walkthrough exercises the CLI
  that both the panel and the command line share via `src/import.ts`.
- **`--each` scope** — the walkthrough imports whole packages as one entry;
  `--each` (one entry per candidate root) is covered by
  `test/import.test.ts`.
- **External entries** — `export --all` skipping `ownership: 'external'`
  entries is covered by `test/export.test.ts`; the walkthrough does not
  create external entries (they require `--link-only` setup).
- **Node 20 / 22 / 24 matrix** — CI runs the full gate set on push/PR.

# dsh-skills-nexus

[![CI](https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml)
![GitHub License](https://img.shields.io/github/license/xiaxi626/dsh-skills-nexus)

**English** | [中文](README_CN.md)

⭐ **If this project helps you, welcome to Star for support!**

A universal DSH skill adapter. **Install once**, then register **any** GitHub
repo that contains a `SKILL.md` as a DSH skill — one command at a time. The
skill repo itself stays pure: no Cordis plugin code, no `package.json`, no
`cordis.patch.yml` required.

Nexus works by cloning SKILL.md repos to a local `~/.dsh/skills-nexus/repos/`
directory and creating symlinks in the official DSH skills root
(`~/.dsh/skills/`). The official filesystem provider automatically discovers,
watches, and serves them — no custom provider or runtime scanning needed.

## Architecture overview

```mermaid
flowchart TD
    subgraph SRC["GitHub"]
        G[("SKILL.md<br/>repos")]
    end

    subgraph NEXUS["dsh-skills-nexus  (~/.dsh/skills-nexus/)"]
        A["CLI<br/><i>add · update · remove</i>"]
        M["manifest.json<br/><i>state backend</i>"]
        R["repos/<br/><i>full git clones</i>"]
    end

    subgraph DSH["Official DSH root  (~/.dsh/skills/)"]
        L["symlinks<br/><i>auto-discovered</i>"]
        P["filesystem provider"]
        C["ctx.skills<br/><i>skill catalog</i>"]
    end

    G -->|"1  git clone"| A
    A -->|"2  reads / writes"| M
    A -->|"3  stores clones"| R
    A -->|"4  creates symlinks"| L
    L -.->|"symlink targets repos/"| R
    L -->|"5  scanned by"| P
    P -->|"6  registers"| C

    style A fill:#e8f4fd,stroke:#3b82f6,stroke-width:2px,color:#000
    style P fill:#f0fdf4,stroke:#22c55e,stroke-width:2px,color:#000
    style M fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#000
    style R fill:#f5f3ff,stroke:#8b5cf6,stroke-width:2px,color:#000
    style L fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#000
    style C fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#000
    style G fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#000
```

- **CLI writes**: `add` / `update` / `remove` commands operate git, update `manifest.json`, and create/remove symlinks in `~/.dsh/skills/`
- **Official provider reads**: the built-in filesystem provider scans `~/.dsh/skills/` and discovers skills through symlinks
- **Decoupled**: CLI only manages clones and symlinks; discovery and serving are entirely handled by the official provider

## Why

`dsh plugin --profile <name> add "github:owner/repo"` forwards to pnpm, and
**only packages with `dsh.bundle.patch` are activated as profile layers**. A
content repo with just `SKILL.md` + `references/` + `scripts/` has no Cordis
wrapper, so this path doesn't work. `dsh-skills-nexus` fills the gap:

| command | installs | requires `dsh.bundle.patch`? |
|---|---|---|
| `dsh plugin add github:owner/dsh-skills-nexus` | nexus itself (once) | yes |
| `dsh-skills-nexus add github:owner/any-skill` | pure SKILL.md content repo | **no** |

> **Not sure which command fits your repo?** Read
> **[nexus vs `dsh plugin` — when to use which](docs/nexus-vs-plugin.md)**.
> Short version: repo has `SKILL.md` → nexus; repo is a pure plugin
> (`cordis.patch.yml` / `dsh.bundle.patch`, no `SKILL.md`) → `dsh plugin`;
> has both → your choice (nexus = content, plugin = code).

## Install nexus

```bash
dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"
```

Restart the profile once. The `dsh-skills-nexus` CLI command is then available.
`lib/` compiled artifacts are committed with the repo — install and use.

## Usage

```bash
# register a skill repo (cloned under ~/.dsh/skills-nexus/repos/<name>/)
dsh-skills-nexus add github:owner/repo
dsh-skills-nexus add github:owner/repo#dev          # pick a branch/tag
dsh-skills-nexus add https://github.com/owner/repo
dsh-skills-nexus add owner/repo                     # shorthand
dsh-skills-nexus add github:owner/repo --yes         # skip "wrapped repo?" prompt
dsh-skills-nexus add github:owner/repo --subdir skills/foo   # install one subdir of a collection repo

# inspect / maintain
dsh-skills-nexus list                               # all registered skills (+ commit, subdir, status)
dsh-skills-nexus update [name]                      # refresh (branch pin: pull; tag/commit pin: verify)
dsh-skills-nexus enable  <name>                     # create symlink (default)
dsh-skills-nexus disable <name>                     # remove symlink without deleting clone
dsh-skills-nexus remove <name>                      # delete clone + symlink + unregister
```

Accepted repo forms: `github:owner/repo[#ref]`, full `https://` URL (incl.
`/tree/<ref>/...` subpaths), `git+https://`, `git@`/`ssh://`, and bare
`owner/repo` shorthand.

When you `add` a repo, nexus inspects the clone before registering it:

- **Plain SKILL.md repo** — registered directly.
- **SKILL.md + DSH plugin wrapper** — asks whether to ignore the wrapper and manage as a plain SKILL.md repo. Type `y` to continue, `n` to abort and suggest installing via `dsh plugin add`. Use `--yes` to skip the prompt.
- **Pure DSH plugin (no SKILL.md)** — prints a message telling you to use that repo's own DSH plugin installation flow, then exits without registering.
- **Neither** — reports that no SKILL.md or DSH plugin marker was found and exits with an error.
- **Collection repos** (`skills/<name>/SKILL.md` layout, e.g. `trae-community/trae-skills`) — installing the whole repo yields no installable skill at the root; nexus rejects it and suggests `--subdir <path>`. Installations that yield more than 20 skills trigger a confirmation prompt (skip with `--yes`).

## SKILL.md discovery (per cloned repo)

1. `<repoRoot>/SKILL.md` — authoritative; repo treated as a single skill.
2. `<repoRoot>/<name>/SKILL.md` — repo bundles one skill per subdirectory (single-level only, matching the official filesystem provider; nested `**/SKILL.md` is excluded).
3. `<repoRoot>/<name>.md` — flat markdown (no bundled resources).

`README.md` / `CHANGELOG.md` / `LICENSE.md` are skipped in the flat scan.

### Frontmatter fields honored

Required: `name`, `description`. Optional, respected by the provider:
`disable-model-invocation` (bool), `user-invocable` (bool). Any other fields
(`whenToUse`, `metadata`, …) are parsed and preserved.

> **Note**: nexus normalizes invalid frontmatter names at install time (converted
> to kebab-case) and fills in missing descriptions, so the official provider
> never silently skips a skill due to bad frontmatter.

## Filesystem layout

```
~/.dsh/
├── skills/                          # official DSH skills root (provider scans here)
│   ├── skill-a/        → symlink →  ~/.dsh/skills-nexus/repos/repo-a/
│   └── skill-b/        → symlink →  ~/.dsh/skills-nexus/repos/repo-b/skills/foo/
│
└── skills-nexus/
    ├── manifest.json                 # state backend: CLI writes
    └── repos/                        # full git clones live here
        ├── repo-a/                  # full git clone (nexus-managed)
        │   ├── SKILL.md
        │   └── references/…
        └── repo-b/
            └── skills/
                └── foo/
                    └── SKILL.md
```

**Why two directory layers?**

- `repos/` is nexus's private storage — all git clones live here, keeping their original structure intact. The CLI uses git to clone / pull / checkout these directories. Clones are nexus-managed: `add` / `update` may normalize frontmatter in place (fix invalid names, add missing `description`), and `update` discards local changes before pulling (with a warning) — do not edit clones by hand.
- `~/.dsh/skills/` is the official DSH skills root — the official filesystem provider only scans this level. Nexus creates one symlink per skill here, pointing to the actual directory in `repos/`. This way the official provider discovers all skills automatically, with no custom provider needed.

`enable` / `disable` simply create/remove symlinks — lightweight and atomic, clone data always stays in `repos/`. `remove` deletes both the symlink and the clone directory.

Override the root with `DSH_HOME` (defaults to `~/.dsh`) or
`DSH_SKILLS_NEXUS_HOME` (defaults to `<DSH_HOME>/skills-nexus`).

## Uninstall

Two levels, choose as needed:

### Remove individual skills

```bash
# list registered skills
dsh-skills-nexus list

# remove one (deletes symlink, clone directory, and unregisters)
dsh-skills-nexus remove <skill-name>
```

The skill disappears from the DSH catalog on the next reload. All other
registered skills are unaffected.

### Uninstall nexus itself

```bash
# 1. (optional) remove all managed skills first, cleaning ~/.dsh/skills-nexus/
dsh-skills-nexus remove <name1>
dsh-skills-nexus remove <name2>
# ...

# 2. remove the plugin from the DSH profile
dsh plugin --profile web remove dsh-skills-nexus

# 3. (optional) delete leftover state
#    macOS / Linux:
rm -rf ~/.dsh/skills-nexus
#    Windows PowerShell:
# Remove-Item -Recurse -Force ~/.dsh/skills-nexus

# 4. (optional) delete the local test directory
#    Windows PowerShell:
# Remove-Item -Recurse -Force dsh-skills-nexus
```

Restart the DSH profile. The `dsh-skills-nexus` CLI and all its skills will be
removed.

## Local testing steps

You can fully test nexus on your machine without pushing to GitHub or
publishing to npm. Follow these five steps.

### Step 1 — build the project

Inside the `dsh-skills-nexus/` directory:

```bash
cd dsh-skills-nexus
npm install
npm run build      # generates lib/
```

> If you've made changes and want to verify types before building, run
> `npm run typecheck` (type-check only, no output).

### Step 2 — create a local overlay

Create `overlay.yml` in the project root (note: **do not commit this to git**,
it's for local development only):

```yaml
# overlay.yml
- insert:
    - id: dsh-skills-nexus
      # Windows: '/C:/your/path/dsh-skills-nexus/lib/index.js'
      # macOS:   '/Users/your/path/dsh-skills-nexus/lib/index.js'
      # Linux:   '/home/your/path/dsh-skills-nexus/lib/index.js'
      name: '/your/absolute/path/dsh-skills-nexus/lib/index.js'
```

> `name` should be the **absolute path** to `lib/index.js`. On Windows, prefix
> the drive letter with `/`, e.g. `'/C:/dev/dsh-skills-nexus/lib/index.js'`;
> on macOS / Linux, use a standard absolute path, e.g.
> `'/home/user/dsh-skills-nexus/lib/index.js'`.

**Or generate it with a one-liner** (make sure you've cd'd into the project dir):

**Windows (Git Bash / MINGW):**

```bash
cat > overlay.yml <<EOF
- insert:
    - id: dsh-skills-nexus
      name: '/$(pwd -W)/lib/index.js'
EOF
```

> `pwd -W` outputs a Windows-style absolute path (e.g. `C:/Users/xxx/dsh-skills-nexus`).
> You must prefix it with `/`, resulting in `/C:/Users/xxx/dsh-skills-nexus/lib/index.js`.
> Node.js ESM loader doesn't accept bare `C:/...` paths on Windows (treats `c:` as a
> protocol) — it must be `/C:/...` or `file:///C:/...`.

**macOS / Linux:**

```bash
cat > overlay.yml <<EOF
- insert:
    - id: dsh-skills-nexus
      name: '$(pwd)/lib/index.js'
EOF
```

> `pwd` outputs a Unix-style absolute path (e.g. `/Users/xxx/dsh-skills-nexus`),
> which already starts with `/`, resulting in `/Users/xxx/dsh-skills-nexus/lib/index.js`.

### Step 3 — start DSH in patch mode

```bash
npx @deepseek-ai/dsh web --patch overlay.yml
```

This mounts nexus as a temporary layer in the current profile, making the
`dsh-skills-nexus` CLI command available. **After changing code, re-run
`npm run build` and restart DSH to pick up changes.**

### Step 4 — add a skill and test with the CLI

> **Note**: do **not** move the project folder during local testing. If you
> move it after `npm link`, re-running `npm link` will fail with
> `EEXIST: file already exists` — the global link still points to the old
> location. See the fix below.

Open another terminal:

```bash
# link the CLI globally for easy access
cd dsh-skills-nexus
npm link

# add a real skill repo to test with
dsh-skills-nexus add github:xiaxi626/theme-port-skill

# verify it was registered
dsh-skills-nexus list

# check that symlinks were created in the official root
ls -la ~/.dsh/skills/
```

**If you moved the folder and `npm link` fails with EEXIST:**

Option A — overwrite with `--force` (simplest, works on all platforms):

```bash
npm link --force
```

Option B — manually remove stale global links, then re-link:

**Git Bash:**

```bash
rm -f "$(npm prefix -g)/dsh-skills-nexus"
rm -f "$(npm prefix -g)/dsh-skills-nexus.cmd"
rm -f "$(npm prefix -g)/dsh-skills-nexus.ps1"
npm link
```

**Windows PowerShell:**

```powershell
Remove-Item -Force "$(npm prefix -g)\dsh-skills-nexus*"
npm link
```

> Using `$(npm prefix -g)` instead of `~` or hardcoded paths ensures
> the correct global npm directory is resolved regardless of `HOME`
> misconfiguration in Git Bash.

### Step 5 — verify in DSH

> **Note**: the DSH process started in Step 3 with `--patch` was running
> **before** you added a skill in Step 4, so asking "what skills do you have?"
> in the original DSH session won't show the new skill — the provider hasn't
> scanned it yet.
>
> **You must stop and restart**: go back to the terminal from Step 3, press
> `Ctrl+C` to stop the process, then re-run:
> ```bash
> npx @deepseek-ai/dsh web --patch overlay.yml
> ```
> After restart, DSH reloads the filesystem provider, which scans
> `~/.dsh/skills/` for symlinks and discovers the skill you just added.

Once restarted, ask "what skills do you have?" or similar in the DSH session,
and check whether `theme-port-skill` appears in the skill list.

---

## Lighter verification (without starting DSH)

If you just want to verify the "clone + symlink creation + list" pipeline
without starting DSH, use the CLI directly:

```bash
# add a skill
dsh-skills-nexus add github:xiaxi626/theme-port-skill

# check registration
dsh-skills-nexus list

# verify symlinks were created
ls -la ~/.dsh/skills/
```

> If `list` shows the expected skill and `ls -la` shows symlinks pointing to
> `repos/` directories, the clone + symlink pipeline is working correctly.

---

## How it works

```
dsh-skills-nexus add github:owner/repo
   └─ git clone --depth 1 →  ~/.dsh/skills-nexus/repos/<name>/
   └─ normalize frontmatter  (fix invalid names to kebab-case, add missing description)
   └─ create symlink     →  ~/.dsh/skills/<skill-name>/  →  points to repos/<name>/
   └─ append entry       →  ~/.dsh/skills-nexus/manifest.json

DSH filesystem provider (official, built-in)
   └─ scans ~/.dsh/skills/ → discovers all symlinked skills automatically
   └─ reads each SKILL.md's frontmatter + body
```

Key design points:

- **Symlinks instead of a custom provider**: the official filesystem provider
  handles discovery, file watching, and error tolerance — no custom provider
  code to maintain.
- **Per-skill `resourceBase`**: each symlink points at that skill's own clone
  directory, so relative paths (`references/`, `scripts/`, `assets/`) resolve
  correctly.
- **Multi-skill repos work**: collection repos create one symlink per
  discovered skill — all visible at the top level of `~/.dsh/skills/`, matching
  the official provider's single-level scan.
- **Install-time normalization**: invalid frontmatter names are fixed and
  missing descriptions are filled in, so the official provider never silently
  skips a skill.
- **Lightweight enable/disable**: just create/remove symlinks — clone data
  always stays in `repos/`.

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

## Notes & limitations

- **`add` then visibility**: newly added skills appear after DSH rescans
  `~/.dsh/skills/`. If the profile was already running, reload it — the
  official filesystem provider will rescan the skills root and pick up newly
  created symlinks.
- **Version pinning & updates**: pin a ref with `#branch`, `#tag`, or
  `#commit-sha`. At install time the manifest records the exact resolved
  commit (`commit`) — a lightweight lock that `list` shows. `update` only
  fast-forwards **branch**-pinned skills (printing the commit change);
  **tag/commit**-pinned skills are fixed points: it verifies the checkout
  still matches the pin (and restores it if it drifted) instead of pulling, so
  a pinned version never silently drifts. When no `#ref` is given, the CLI
  detects the remote's default branch via `git ls-remote --symref` (falls back
  to `main`).
- **Skill content repos only**: this is *not* a replacement for `dsh plugin add`
  of real Cordis plugins. If a repo already ships a `dsh.bundle.patch`, install
  it the normal way — nexus is for repos that don't. See
  [nexus vs `dsh plugin`](docs/nexus-vs-plugin.md) for the full decision guide.
- **Collection repos & `--subdir`**: collection repos (skills nested under
  subdirectories, e.g. `trae-community/trae-skills`) are installed piecemeal
  with `--subdir <path>` — each install is its own entry with its own clone
  (independent-clone design, see [docs/subdir-design.md](docs/subdir-design.md)
  for the P1/P2 trade-off). Installing the whole repo without `--subdir` is
  guarded by a confirmation prompt above 20 skills.
- **Flat-markdown filter**: a flat `*.md` file without frontmatter `name` AND
  `description` is not treated as a skill — collection-repo docs like
  `README.zh-CN.md`, `CONTRIBUTING.md` or `community-leaderboard.md` are never
  "fake-installed". Doc-like names (`readme*`, `contributing*`, `license*`,
  `changelog*`, `code-of-conduct*`, `security*`) are skipped at discovery.
- **Name collisions**: DSH indexes skills by name; a later install with the
  same name overwrites. Use `--name` to distinguish entries, or `--subdir` to
  install only what you need. enable/disable work per entry, `remove` deletes
  the whole entry's clone and all its symlinks.
- **Skill name validation**: DSH requires lowercase kebab-case skill names
  (`[a-z0-9]+` segments separated by single `-`). nexus normalizes invalid
  frontmatter names at `add` time (converted to kebab-case) and warns with `⚠`.
- **Build scripts**: because nexus clones content repos itself (not via pnpm),
  it sidesteps pnpm `allowBuilds` interception entirely.
- **Windows symlinks**: creating symlinks on Windows requires Developer Mode or
  admin privileges. If symlink creation fails, the skill won't appear in the
  catalog — enable Developer Mode in Windows Settings or run as Administrator.

## License

MIT

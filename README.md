# dsh-skills-nexus

[![CI](https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml)
[![dsh.so risk](https://www.dsh.so/badge/dsh-skills-nexus.svg)](https://www.dsh.so/artifact/dsh-skills-nexus/)
[![dsh.so install](https://www.dsh.so/badge/install/dsh-skills-nexus.svg)](https://www.dsh.so/artifact/dsh-skills-nexus/)
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

Install the CLI globally — **this** is what puts the `dsh-skills-nexus` command
on your shell PATH:

```bash
npm install -g github:xiaxi626/dsh-skills-nexus
```

`lib/` compiled artifacts are committed with the repo, so there is no build
step — install and use. (Once the package is published to npm you can use
`npm install -g dsh-skills-nexus` instead.)

> **`dsh plugin add` does NOT provide the shell command.** Registering nexus as
> a DSH plugin (`dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"`)
> only installs the package into the profile's `node_modules` and registers a
> Cordis layer whose `apply()` is an intentional no-op — skill discovery happens
> through the symlinks nexus creates in `~/.dsh/skills/` plus the official
> filesystem provider. The plugin layer is therefore optional on both counts: it
> has no effect on the CLI, and skills load without it too — discovery runs
> entirely through the symlinks + the official provider. The
> `dsh-skills-nexus` command comes only from the global npm install above (or
> `npm link` during development).

## Usage

```bash
# register a skill repo (cloned under ~/.dsh/skills-nexus/repos/<name>/)
dsh-skills-nexus add github:owner/repo
dsh-skills-nexus add github:owner/repo#dev          # pick a branch/tag
dsh-skills-nexus add https://github.com/owner/repo
dsh-skills-nexus add owner/repo                     # shorthand
dsh-skills-nexus add github:owner/a github:owner/b  # install several repos in one call
dsh-skills-nexus add github:owner/repo --yes         # skip "wrapped repo?" prompt
dsh-skills-nexus add github:owner/repo --subdir skills/foo   # install one subdir of a collection repo
dsh-skills-nexus add github:owner/repo --subdir skills --name owner-skills   # custom entry name (fallback chain: --name > subdir leaf > repo name)

# inspect / maintain
dsh-skills-nexus list                               # all registered skills (+ source repo, commit, subdir, status)
dsh-skills-nexus update [name]                      # refresh (branch pin: pull; tag/commit pin: verify)
dsh-skills-nexus enable  <name>                     # create symlink (default)
dsh-skills-nexus disable <name>                     # remove symlink without deleting clone
dsh-skills-nexus remove <name>...                   # delete clone + symlink + unregister (one or more)
dsh-skills-nexus remove 'theme-*'                   # ...or a * / ? glob matched against skill names
dsh-skills-nexus doctor [--json] [--updates] [--quiet]  # read-only full checkup of nexus state (exit 0/1/2)
dsh-skills-nexus completions --shell <bash|zsh|fish|powershell>  # print a completion script for that shell
```

Value options (`--name`, `--ref`, `--subdir`) also accept the `--flag=value` form (e.g. `--subdir=skills/foo`, `--name=owner-skills`); the boolean `--yes` takes no value.

`add` accepts multiple repo specs and `remove` accepts multiple names plus `*`/`?` globs; each target is handled independently and the exit code is non-zero if any one failed. Because `--name`/`--ref`/`--subdir` are per-repo, they cannot be combined with multiple `add` specs — run separate `add` commands to customize each. A `remove` glob matching more than one skill lists them and asks for confirmation first (`--yes` skips it); quote the pattern (`'theme-*'`) so your shell does not expand it.

Accepted repo forms: `github:owner/repo[#ref]`, full `https://` URL (incl.
`/tree/<ref>/...` subpaths), `git+https://`, `git@`/`ssh://`, and bare
`owner/repo` shorthand.

When you `add` a repo, nexus inspects the clone before registering it:

- **Plain SKILL.md repo** — registered directly.
- **SKILL.md + DSH plugin wrapper** — asks whether to ignore the wrapper and manage as a plain SKILL.md repo. Type `y` to continue, `n` to abort and suggest installing via `dsh plugin add`. Use `--yes` to skip the prompt.
- **Pure DSH plugin (no SKILL.md)** — prints a message telling you to use that repo's own DSH plugin installation flow, then exits without registering.
- **Neither** — reports that no SKILL.md or DSH plugin marker was found and exits with an error.
- **Collection repos** (`skills/<name>/SKILL.md` layout, e.g. `trae-community/trae-skills`) — installing the whole repo yields no installable skill at the root; nexus rejects it and suggests `--subdir <path>`. Installations that yield more than 20 skills trigger a confirmation prompt (skip with `--yes`).

## Shell completion

`dsh-skills-nexus completions --shell <bash|zsh|fish|powershell>` prints a
completion script for that shell — subcommands, per-command flags, and the
installed skill names (fetched through `dsh-skills-nexus list --names`). Load
it once in the shell you use:

```bash
# bash (~/.bashrc)
eval "$(dsh-skills-nexus completions --shell bash)"

# zsh (~/.zshrc, after compinit)
eval "$(dsh-skills-nexus completions --shell zsh)"

# fish (once, or save as ~/.config/fish/completions/dsh-skills-nexus.fish)
dsh-skills-nexus completions --shell fish | source
```

```powershell
# PowerShell ($PROFILE)
dsh-skills-nexus completions --shell powershell | Out-String | Invoke-Expression
```

To unload, delete the loading line from your profile and undo the
registration in the current session — or simply open a new terminal if you
never wrote the line to a profile:

```bash
# bash
complete -r dsh-skills-nexus
unset -f _dsh_skills_nexus

# zsh
compdef -d dsh-skills-nexus
unfunction _dsh_skills_nexus

# fish
complete -c dsh-skills-nexus -e
```

```powershell
# PowerShell — re-register with a null script block to remove the completer
Register-ArgumentCompleter -Native -CommandName dsh-skills-nexus -ScriptBlock $null
```

Completion of the command **name** itself needs no script — your shell
completes executables from `PATH`, so having the npm global bin on `PATH` is
already enough. The scripts above complete the command's arguments. For the
full per-shell verification walkthrough see
[Verifying shell completion](docs/verify-completions.md).

## Uninstall

Two levels, choose as needed:

### Remove individual skills

```bash
# list registered skills
dsh-skills-nexus list

# remove one (deletes symlink, clone directory, and unregisters)
dsh-skills-nexus remove <skill-name>

# remove several at once — by name, or by a * / ? glob (quote it)
dsh-skills-nexus remove <name1> <name2>
dsh-skills-nexus remove 'theme-*' --yes
```

The skill disappears from the DSH catalog on the next reload. All other
registered skills are unaffected.

### Uninstall nexus itself

Nexus leaves **three independent things**, cleaned by *different* commands —
removing one does **not** remove the others. The annotated block below clears
each one; run only the lines you need.

> **The trap everyone hits — read this first.** The `dsh-skills-nexus` you type
> in the shell comes **only** from item 3 below (`npm link` or `npm install -g`).
> `--patch` mounts a layer for the current DSH process only, and `dsh plugin add`
> only writes the profile's `node_modules` — **neither puts a command on your
> shell PATH**. So "I installed the GitHub version but it still runs my local
> logic" means the command you typed went through item 3's `npm link` into your local
> workspace; it has nothing to do with the copy GitHub installed into item 2. To
> really switch to remote: `npm uninstall -g dsh-skills-nexus`, then
> `npm install -g github:<owner>/<repo>`.

```bash
# 1. skill DATA — the clones + manifest under ~/.dsh/skills-nexus/ (data, not the command)
dsh-skills-nexus remove '*' --yes          # '*' matches every registered skill

# 2. DSH profile plugin layer — only if you used `dsh plugin add` (--patch does NOT write here)
dsh plugin --profile web remove dsh-skills-nexus

# 3. global CLI command — THIS is the `dsh-skills-nexus` you type in the shell
npm uninstall -g dsh-skills-nexus

# (optional) delete any leftover skill-data directory from item 1
#    macOS / Linux:
rm -rf ~/.dsh/skills-nexus
#    Windows PowerShell:
# Remove-Item -Recurse -Force ~/.dsh/skills-nexus
```

Restart the DSH profile. The plugin layer, the CLI command and all managed
skills will be gone.

> **Never** "clean up" with a bare relative `Remove-Item -Recurse -Force
> dsh-skills-nexus`: its effect depends on the current directory — from the npm
> global prefix it deletes the CLI's bin shims (the command suddenly becomes
> "not found"), and from your clone's parent it deletes your source tree. If
> you truly want to discard the local clone, delete it by explicit full path.

**Fallback — manual removal (only if `npm uninstall -g` is unavailable).**
Delete the bin shims first, then the link. **Never** pass `-Recurse` when
removing the link: it is a junction/symlink into your clone, and `-Recurse`
would follow it and delete your source tree.

```powershell
# Windows PowerShell
Remove-Item -Force "$(npm prefix -g)\dsh-skills-nexus*"               # bin shims
Remove-Item -Force "$(npm prefix -g)\node_modules\dsh-skills-nexus"   # the link — NO -Recurse
```

On Git Bash / macOS / Linux just use `npm uninstall -g dsh-skills-nexus`;
do not hand-delete the link there (`rm` on a directory-style link is unsafe).

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

This mounts nexus as a temporary layer **for this DSH process only** — stop the
process and the layer is gone; nothing is persisted to the profile. Note it
does **not** put the `dsh-skills-nexus` CLI on your shell PATH; the shell
command comes from `npm link` in Step 4. **After changing code, re-run
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

Option B — remove the stale global link with npm, then re-link (all platforms):

```bash
npm uninstall -g dsh-skills-nexus
npm link
```

> Prefer `npm uninstall -g` over manually deleting files under the npm global
> prefix: it removes the bin shims and the link in one safe step, and avoids
> `Remove-Item` / `rm` footguns on a symlinked global package.

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

### Clean up after local testing

`--patch` wrote nothing to the profile, so there is no plugin to remove. Local
testing leaves just two things — the skill data and the `npm link` — so follow
[Uninstall nexus itself](#uninstall-nexus-itself) items 1 and 3 (run
`dsh-skills-nexus remove '*' --yes` first, then `npm uninstall -g
dsh-skills-nexus`); skip item 2 (`dsh plugin remove`), which does not apply
here.

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
  guarded by a confirmation prompt above 20 skills. Entries cherry-picked from
  the same repo each keep their own clone, but `list` shows a **SOURCE** column
  (the origin `owner/repo`) so same-origin entries are easy to spot.
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
- **Windows links**: nexus creates directory junctions on Windows
  (`symlink(..., 'junction')`) and plain directory symlinks elsewhere — neither
  needs Developer Mode or admin privileges.

## For tool builders

Want to build on nexus — a GUI, a sync daemon, a CI job, or a higher-level
installer that installs GitHub `SKILL.md` repos into DSH? Nexus already solves
the fiddly cross-platform parts (spec parsing, clone-with-retry, ref pinning,
frontmatter normalization, collection `--subdir`, Windows-junction symlinks)
and exposes two stable, read-only machine interfaces you can depend on:
`dsh-skills-nexus list --names` (enumerate installed skills) and
`dsh-skills-nexus doctor --json` (a versioned health report). Shell out to the
CLI — never `import` package internals or read `manifest.json`. See
**[Building on nexus — machine interfaces for tool authors](docs/build-on-nexus.md)**
for the full contract, the ecosystem boundary, and the explicit list of
interfaces that are **not** promised.

## Documentation

- [Architecture — data flow, directory layout, SKILL.md discovery](docs/ARCHITECTURE.md)
- [nexus vs `dsh plugin` — when to use which](docs/nexus-vs-plugin.md)
- [Subdir design — P1/P2 trade-off for collection repos](docs/subdir-design.md)
- [Verifying the version-lock feature (P0)](docs/verify-version-lock.md)
- [Verifying the clone-retry feature (P0)](docs/verify-clone-retry.md)
- [Verifying collection-repo support (P1)](docs/verify-collection-support.md)
- [Verifying the plugin-load contract (plugin add → dsh web cold boot)](docs/verify-plugin-install.md)
- [Verifying the `doctor` command (P0)](docs/verify-doctor.md)
- [Verifying shell completion](docs/verify-completions.md)
- [Building on nexus — machine interfaces for tool authors](docs/build-on-nexus.md)
- [Contributing — project layout, testing & CI](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Contributing

Contributions of all kinds are welcome — bug fixes, new commands, docs.
See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout, local setup, and
quality gates.

Found a bug or have an idea?
[Open an issue](https://github.com/xiaxi626/dsh-skills-nexus/issues/new/choose)
— we use issue templates to make it easy.

## License

MIT

# Verifying shell completion

This guide verifies the **`completions`** command — the completion scripts that
`dsh-skills-nexus completions --shell <shell>` emits:

- `--shell` accepts `bash`, `zsh`, `fish` or `powershell` and writes that
  shell's script to stdout. Any other value is a usage error (exit 2) with
  **empty stdout** — a script that pipes the output never receives half a
  template.
- Each script completes three layers: the subcommand, the flags of that
  subcommand, and — for the name-taking commands — the installed skill names.
  "First positional" is counted by ignoring `-`-prefixed words, so
  `remove --yes <TAB>` still offers names.
- The name layer shells out to `dsh-skills-nexus list --names`; no script reads
  `manifest.json`, so an internal schema change cannot silently break
  completion.

> **Shell warning — run each block in the shell named in its heading.** The
> bash block runs in Git Bash (Windows) or any POSIX shell; the PowerShell
> block runs in PowerShell; the zsh / fish block runs where those shells exist
> (macOS, Linux, WSL). Do not paste a POSIX block into PowerShell or vice
> versa. Blocks use absolute paths or `git -C <dir>`; none of them leaves a
> `cd` behind (the fish part swaps to a temp dir with `pushd` and back), so
> your working tree cannot be polluted.

Everything below is safe: it uses an isolated `DSH_HOME` under a temp dir, two
local `file://` upstream repos stand in for GitHub (no network), and your real
`~/.dsh` is never touched. Delete the temp dirs at the end.

## Prerequisites

- Node.js ≥ 20 and git on `PATH`, plus the shell you want to verify
- Repo checked out and `npm install` done (the test suite runs via `tsx` from
  `node_modules`)
- If you changed `src/`, run `npm run build` first — the walkthrough runs the
  compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx — expected: all tests pass
npm run build       # tsc → lib/
node --import tsx --test test/completions.test.ts   # just this feature
```

| test file | what it verifies |
|---|---|
| `test/completions.test.ts` | argument parsing (`--shell` in both spellings, unsupported shells, usage errors leaving stdout empty); the four templates as text (subcommand list vs. the CLI router, per-command flags, no `--yes` for update/pull, `list --names` and never `manifest.json`, pure ASCII); and **three execution tests that run the emitted scripts in a real bash / zsh / fish** |

The three execution tests self-skip when their shell is missing — a Windows
dev box has bash (Git Bash) but neither zsh nor fish, so there two tests skip.
The CI Linux job installs both shells so every template is executed on each
push; macOS runs zsh natively. PowerShell has no runner in this project's CI,
so its template is pinned as text and its rules were measured by hand on
PS 5.1 (see Part 2 / Part 3).

---

## Part 2 — end-to-end walkthrough

Each block is self-contained for the shell in its heading: it builds an
isolated fixture (`DSH_HOME` under a temp dir, two `file://` upstream repos
standing in for GitHub), installs two skills (`alpha`, `beta`) as the dynamic
name source, loads the emitted template, and then prints the candidates for a
fixed set of command lines — one `label|candidates` line per case.

### bash — Git Bash (Windows) or any POSIX shell

```bash
PROJECT=~/Downloads/dsh-skills-nexus                  # ← your checkout path
PROJECT_WIN="$(cygpath -m "$PROJECT")"                # POSIX shells: skip this, use "$PROJECT"

TROOT="$(cygpath -m "$TEMP")/nexus-completions"       # isolated playground
UP_A="$TROOT/up-alpha"
UP_B="$TROOT/up-beta"
export DSH_HOME="$TROOT/home"
BIN="$TROOT/bin"
rm -rf "$TROOT"                                       # clean slate
mkdir -p "$UP_A" "$UP_B" "$BIN"

# ---- two upstream repos (stand in for GitHub): one repo per skill, because a
# ---- repo can only be registered under a single name (the clone dir is the slug)
git -C "$UP_A" init -q -b main                        # git >= 2.28
git -C "$UP_A" config user.email t@t
git -C "$UP_A" config user.name t
printf -- '---\nname: alpha\ndescription: alpha skill\n---\n# alpha\n' > "$UP_A/SKILL.md"
git -C "$UP_A" add .
git -C "$UP_A" commit -q -m init

git -C "$UP_B" init -q -b main
git -C "$UP_B" config user.email t@t
git -C "$UP_B" config user.name t
printf -- '---\nname: beta\ndescription: beta skill\n---\n# beta\n' > "$UP_B/SKILL.md"
git -C "$UP_B" add .
git -C "$UP_B" commit -q -m init

# ---- stub CLI on PATH: the templates call `dsh-skills-nexus list --names`,
# ---- and this puts that name on PATH without a global install
printf '#!/bin/sh\nexec node "%s/lib/cli/index.js" "$@"\n' "$PROJECT_WIN" > "$BIN/dsh-skills-nexus"
chmod +x "$BIN/dsh-skills-nexus"
export PATH="$BIN:$PATH"

# ---- install both skills as the dynamic name source ----
dsh-skills-nexus add "file:///$UP_A" --name alpha
dsh-skills-nexus add "file:///$UP_B" --name beta
dsh-skills-nexus list --names                         # alpha, beta

# ---- load the emitted template ----
eval "$(dsh-skills-nexus completions --shell bash)"

# ---- drive it: hand the function the words bash would hand it ----
probe() {  # probe <label> <words...>; the last word is the one being completed
  local label="$1"; shift
  local -a COMP_WORDS=("$@")
  local COMP_CWORD=$(( $# - 1 ))
  # The engine clears COMPREPLY after every round (it unbinds the variable
  # right after reading it), so reset it here to replay each scenario from
  # that same clean state - direct calls would otherwise leak the previous
  # scenario's matches into the next.
  COMPREPLY=()
  _dsh_skills_nexus
  printf '%s|%s\n' "$label" "${COMPREPLY[*]}"
}

probe subcommands   dsh-skills-nexus ""
probe d-prefix      dsh-skills-nexus "d"
probe add-dashes    dsh-skills-nexus add "--"
probe doctor-dashes dsh-skills-nexus doctor "--"
probe shell-bare    dsh-skills-nexus completions --shell ""
probe shell-prefix  dsh-skills-nexus completions --shell "b"
probe update-name   dsh-skills-nexus update ""
probe remove-yes    dsh-skills-nexus rm --yes ""
probe remove-second dsh-skills-nexus rm alpha ""
probe update-flag   dsh-skills-nexus update "--x"

# ---- cleanup ----
rm -rf "$TROOT"
unset DSH_HOME
# $BIN stays on PATH in this shell session only
```

Expected output:

```
subcommands|add list ls update pull remove rm enable disable doctor help completions
d-prefix|disable doctor
add-dashes|--name --ref --subdir --yes
doctor-dashes|--json --updates --quiet
shell-bare|bash zsh fish powershell
shell-prefix|bash
update-name|alpha beta
remove-yes|alpha beta
remove-second|
update-flag|
```

The two empty lines are the interesting ones: names belong to the **first**
positional slot only (`rm alpha <TAB>` has no second slot to fill), and
update/pull take no flags. A trailing empty word is how bash represents "a
space was just typed". Unlike PowerShell, bash offers every flag for a bare
`--` (`doctor-dashes` above).

### PowerShell — Windows

```powershell
# ---- fixture: isolated DSH_HOME + two upstream repos (stand in for GitHub) ----
$PROJ = 'C:/Users/you/dsh-skills-nexus'               # ← your checkout path (forward slashes)
$TROOT = (Join-Path $env:TEMP 'nexus-completions').Replace('\', '/')
$UP_A = "$TROOT/up-alpha"
$UP_B = "$TROOT/up-beta"
$BIN = "$TROOT/bin"
$env:DSH_HOME = "$TROOT/home"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TROOT
New-Item -ItemType Directory -Force -Path $UP_A, $UP_B, $BIN | Out-Null

git -C $UP_A init -q -b main
git -C $UP_A config user.email t@t
git -C $UP_A config user.name t
[System.IO.File]::WriteAllText("$UP_A/SKILL.md", "---`nname: alpha`ndescription: alpha skill`n---`n# alpha`n")
git -C $UP_A add .
git -C $UP_A commit -q -m init

git -C $UP_B init -q -b main
git -C $UP_B config user.email t@t
git -C $UP_B config user.name t
[System.IO.File]::WriteAllText("$UP_B/SKILL.md", "---`nname: beta`ndescription: beta skill`n---`n# beta`n")
git -C $UP_B add .
git -C $UP_B commit -q -m init

# ---- stub CLI on PATH (a .cmd wrapper around lib/) ----
Set-Content "$BIN/dsh-skills-nexus.cmd" "@node `"$PROJ/lib/cli/index.js`" %*"
$env:PATH = "$BIN;$env:PATH"

dsh-skills-nexus add "file:///$UP_A" --name alpha
dsh-skills-nexus add "file:///$UP_B" --name beta
dsh-skills-nexus list --names                         # alpha beta

# ---- load the emitted template into this session ----
dsh-skills-nexus completions --shell powershell | Out-String | Invoke-Expression

# ---- drive it through the engine's own completion API ----
function Show($label, $line) {
  $r = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null)
  $txt = ($r.CompletionMatches | ForEach-Object { $_.CompletionText }) -join ' '
  "{0}|{1}" -f $label, $txt
}
Show subcommands   'dsh-skills-nexus '
Show d-prefix      'dsh-skills-nexus d'
Show add-prefix    'dsh-skills-nexus add --n'
Show shell-bare    'dsh-skills-nexus completions --shell '
Show shell-prefix  'dsh-skills-nexus completions --shell b'
Show update-name   'dsh-skills-nexus update '
Show remove-yes    'dsh-skills-nexus rm --yes '
Show remove-second 'dsh-skills-nexus rm alpha '
Show update-flag   'dsh-skills-nexus update --x'

# ---- cleanup ----
Remove-Item -Recurse -Force $TROOT
Remove-Item Env:DSH_HOME
# $BIN stays on PATH in this session only
```

Expected output:

```
subcommands|add list ls update pull remove rm enable disable doctor help completions
d-prefix|disable doctor
add-prefix|--name
shell-bare|bash zsh fish powershell
shell-prefix|bash
update-name|alpha beta
remove-yes|alpha beta
remove-second| (files from the directory you ran the block in - engine fallback, see Part 3)
update-flag|
```

`remove-second` is the odd line: when the completer offers nothing, PowerShell
falls back to **file-name** completion, so it lists the files around you. That
is engine behaviour and cannot be suppressed from the script — `git rm alpha
<TAB>` does the same. Note that `Register-ArgumentCompleter` only affects the
session it runs in: to keep completion permanently, add the enable line to
your `$PROFILE`.

### zsh & fish — macOS / Linux / WSL

Both shells live on the POSIX side, so they share one fixture. Run the fixture
block in bash, then start the shell you want in the same terminal (a child
shell inherits `DSH_HOME` and `PATH`).

```bash
# ---- fixture (bash): same shape as the blocks above, /tmp paths ----
PROJECT=~/dsh-skills-nexus                           # ← your checkout path
TROOT=/tmp/nexus-completions
UP_A=$TROOT/up-alpha
UP_B=$TROOT/up-beta
export DSH_HOME=$TROOT/home
BIN=$TROOT/bin
rm -rf "$TROOT"
mkdir -p "$UP_A" "$UP_B" "$BIN"

git -C "$UP_A" init -q -b main
git -C "$UP_A" config user.email t@t
git -C "$UP_A" config user.name t
printf -- '---\nname: alpha\ndescription: alpha skill\n---\n# alpha\n' > "$UP_A/SKILL.md"
git -C "$UP_A" add .
git -C "$UP_A" commit -q -m init

git -C "$UP_B" init -q -b main
git -C "$UP_B" config user.email t@t
git -C "$UP_B" config user.name t
printf -- '---\nname: beta\ndescription: beta skill\n---\n# beta\n' > "$UP_B/SKILL.md"
git -C "$UP_B" add .
git -C "$UP_B" commit -q -m init

printf '#!/bin/sh\nexec node "%s/lib/cli/index.js" "$@"\n' "$PROJECT" > "$BIN/dsh-skills-nexus"
chmod +x "$BIN/dsh-skills-nexus"
export PATH="$BIN:$PATH"

dsh-skills-nexus add "file://$UP_A" --name alpha
dsh-skills-nexus add "file://$UP_B" --name beta
dsh-skills-nexus list --names                        # alpha, beta
```

#### zsh

```zsh
# (start zsh from the same terminal so it inherits DSH_HOME / PATH)

# ---- drive it non-interactively, the same way the test suite does:
# ---- `compadd` only works inside a real completion, so record its arguments
# ---- instead; `compdef` normally comes from compinit, so stub it too
compdef() { :; }
compadd() {
  if [[ $1 == -a ]]; then
    CAND+=( "${(P)2}" )      # zsh indirection: expand the array named in $2
  else
    CAND+=( "$@" )
  fi
}
run() {  # run <label> <words...>; the last word is the one being completed
  local -a words CAND
  local CURRENT
  label=$1; shift
  words=("$@")
  CURRENT=$#
  CAND=()
  _dsh_skills_nexus
  print -r -- "$label|${(j: :)CAND}"
}

eval "$(dsh-skills-nexus completions --shell zsh)"

run sub                dsh-skills-nexus ''
run add-flags          dsh-skills-nexus add '--n'
run doctor-bare-dashes dsh-skills-nexus doctor '--'
run shell-values       dsh-skills-nexus completions --shell ''
run update-names       dsh-skills-nexus update ''
run remove-yes         dsh-skills-nexus remove --yes ''
run remove-second      dsh-skills-nexus remove alpha ''
run update-flag        dsh-skills-nexus update '--x'
run unknown-cmd        dsh-skills-nexus nope ''
```

Expected output:

```
sub|add list ls update pull remove rm enable disable doctor help completions
add-flags|-- --name --ref --subdir --yes
doctor-bare-dashes|-- --json --updates --quiet
shell-values|bash zsh fish powershell
update-names|alpha beta
remove-yes|alpha beta
remove-second|
update-flag|
unknown-cmd|
```

Candidates are recorded **unfiltered** on purpose — zsh applies its own
filtering, and this driver checks the layer logic (which set is produced for
which shape of command line), not the final menu; the leading `--` in two
lines is `compadd`'s own end-of-options marker. The interactive end-to-end
check is the real thing: after `eval "$(dsh-skills-nexus completions --shell
zsh)"`, type `dsh-skills-nexus <TAB>`, `dsh-skills-nexus doctor --<TAB>`, or
`dsh-skills-nexus rm --yes <TAB>` by hand and watch the menu. The lines above
are the assertions the test suite runs on Linux and macOS.

#### fish

```fish
# (start fish from the same terminal so it inherits DSH_HOME / PATH)
dsh-skills-nexus completions --shell fish | source

# `complete -C '<cmdline>'` is fish's own "what would you offer here" - the
# engine evaluates every rule and prints the candidates, no terminal needed.
# Run it from an empty directory: fish mixes in file-name completion when no
# rule matches, and an empty dir keeps that noise out.
set -l tmp (mktemp -d); pushd $tmp

complete -C 'dsh-skills-nexus '                       # all 12 subcommands
complete -C 'dsh-skills-nexus d'                      # disable, doctor
complete -C 'dsh-skills-nexus add --'                 # --name --ref --subdir --yes
complete -C 'dsh-skills-nexus doctor --'              # --json --quiet --updates
complete -C 'dsh-skills-nexus completions --shell b'  # bash
complete -C 'dsh-skills-nexus update '                # alpha, beta
complete -C 'dsh-skills-nexus remove --yes '          # includes alpha, beta
complete -C 'dsh-skills-nexus remove alpha '          # no alpha / beta - not the first slot
complete -C 'dsh-skills-nexus update --x'             # nothing

popd
rm -rf $tmp
```

Here the candidates are fully filtered — this is fish's real engine, not a
recording stub. At an empty slot fish may also list the option name itself
(`remove --yes ` includes `--yes` next to the names), which is why only the
meaningful candidates are pinned at those positions. The same sets are
asserted by the test suite (CI Linux; fish is not in any default macOS image).

Finish by cleaning the shared fixture:

```bash
rm -rf /tmp/nexus-completions
unset DSH_HOME
```

---

## Part 3 — engine behaviours worth knowing (not defects)

1. **bash never carries candidates between rounds.** After every completion
   the engine reads `COMPREPLY` and immediately unbinds the variable
   (`pcomplete.c`, `gen_shell_function_matches`), so a stale value cannot leak
   into the next call. The driver above resets `COMPREPLY` only because it
   calls the function outside the engine.
2. **A bare `-` or `--` reaches the completer in bash, zsh and fish — but not
   in PowerShell.** On PS 5.1 the engine invokes no argument completer while
   the word under the cursor is exactly `-` or `--` (measured with `git` as a
   control, which behaves identically), so `doctor --` shows nothing; one more
   character (`doctor --j`) completes normally. bash happily lists all three
   flags for `doctor --`.
3. **PowerShell answers "nothing to offer" with file names.** When a completer
   returns an empty set, the engine falls back to file-name completion —
   visible above as the `remove-second` line. Identical behaviour was measured
   for `git` with the same empty-answer completer, so this is engine policy,
   not the template's. bash, zsh and fish simply stay silent.

---

## Pitfalls seen in practice

1. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.
2. **One repo, one name.** The fixture uses two upstream repos because a repo
   can only be registered under a single name: registering the same URL twice
   under different `--name` values fails with *"A skill named ... is already
   registered"* (the clone directory is the repo slug).
3. **Platform path formats.** Windows Git Bash: convert with `cygpath -m` and
   use `file:///C:/...` URLs. Linux / macOS: plain absolute paths and
   `file:///...` URLs.
4. **The stub is scaffolding, not the product.** Real users have the command
   in `PATH` from `npm install -g`; the stub just points the name at `lib/`
   without a global install.
5. **`git init -b main` needs git ≥ 2.28** (2019). Older git:
   `git init && git -C "$UP_A" symbolic-ref HEAD refs/heads/main`.
6. **zsh needs `compinit`** in an interactive shell (it defines `compdef`); the
   driver stubs both `compdef` and `compadd` because neither works outside a
   real completion.
7. **fish shows file names when nothing matches** — run `complete -C` in an
   empty directory (as the block does) or the current directory's files
   drown the signal.
8. **PowerShell needs an execution policy that allows local scripts**, and
   `Set-Content -NoNewline` is not available in every 5.1 build — that is why
   the fixture writes `SKILL.md` with `[System.IO.File]::WriteAllText`.
9. **Stale `$DSH_HOME`** — a previous run leaves entries behind. Each block
   starts by deleting its temp dir; do the same before re-running.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **Interactive behaviour beyond candidates** — menu layout, matching styles,
  highlighting: once a candidate set is correct, everything after that is the
  shell's own completion system.
- **zsh / fish on Windows** — neither ships with Windows; the test suite
  skips them there and the CI Linux job installs both, macOS runs zsh
  natively.
- **PowerShell in CI** — no Windows-PowerShell runner in this project's CI;
  the template's rules were measured by hand on PS 5.1 (see Part 3) and are
  pinned as text by the test suite.
- **zsh candidate filtering** — the zsh driver records what the layer offers
  before zsh's matcher runs; filtering itself is the shell's.
- **Real GitHub network** — the local `file://` upstream exercises the same
  clone + `list --names` path without network flakiness.
- **Node 20 / 22 / 24 matrix** — CI (`.github/workflows/ci.yml`) runs the full
  quality-gate set on push/PR.

# Verifying collection-repo support (P1)

This guide verifies the **collection-repo support** changes:

- **A. Flat-markdown conservatism** — collection-repo docs (`README.zh-CN.md`,
  `CONTRIBUTING.md`, `community-leaderboard.md`, …) are never "fake-installed":
  discovery skips doc-like names by prefix pattern, and a flat `*.md` without
  frontmatter `name` **and** `description` is not a skill.
- **B. `--subdir <path>`** — install one subdirectory of a collection repo
  (`skills/<name>/SKILL.md` layout, e.g. `trae-community/trae-skills`) as its
  own entry with its own clone (independent-clone design, v1).
- **C. Guards** — installing a repo whose root yields zero installable skills
  is rejected with a `--subdir` hint; installs yielding > 20 skills require
  confirmation (`--yes` skips, non-TTY defaults to reject).

Everything below is safe: nothing touches your real `~/.dsh`, no GitHub repo is
contacted, and the current repo is only read (or rebuilt via `npm run build`).
All temporary state lives under dedicated temp dirs you delete at the end.

## Prerequisites

- Node.js ≥ 18 and git on `PATH`
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
npm run test:build  # optional: compile src+test to test-dist/ for loader-free runs
```

New coverage in this change:

| test file | what it verifies |
|---|---|
| `test/add.test.ts` | `--subdir` install (name/path rules), missing subdir fails + cleans up, nested collection without `--subdir` rejected, invalid subdir values, large-collection guard |
| `test/locator.test.ts` | doc variants (`README.zh-CN.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, …) skipped by prefix pattern |
| `test/resolve.test.ts` | flat md without frontmatter is not a skill; entry `subdir` resolution; `previewSkills` |
| `test/args.test.ts` | `--subdir` parsing + missing-value error |
| `test/repo-kind.test.ts` | `markerDir` override (plugin markers at clone root, skills in subdir) |
| `test/toggle.test.ts` | disable/enable, `list` state, and bare-`update` target filter for multi-skill entries (state resolved by link target, not entry name) |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.
Steps `[a]`–`[h]` are the full behavior surface of this change.

### Windows (Git Bash / MINGW64)

```bash
# ---- upstream collection repo (simulates trae-skills layout) ----
COLL="$(cygpath -m "$TEMP/nexus-col")"
DEMO="$(cygpath -m "$TEMP/nexus-col-demo")"
rm -rf "$COLL" "$DEMO"
mkdir -p "$COLL/skills/alpha" "$COLL/skills/beta"
printf -- '---\nname: alpha-skill\n---\nA\n' > "$COLL/skills/alpha/SKILL.md"
printf -- '---\nname: beta-skill\n---\nB\n' > "$COLL/skills/beta/SKILL.md"
printf '# docs\n' > "$COLL/README.zh-CN.md"              # root docs — must never become skills
printf '# board\n' > "$COLL/community-leaderboard.md"
printf '# contributing\n' > "$COLL/CONTRIBUTING.md"
cd "$COLL" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/Downloads/dsh-skills-nexus                  # ← your path
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] whole-repo add: expected rejected + --subdir hint, exit=1 ---"
node lib/cli/index.js add "file:///$COLL"; echo "exit=$?"

echo "--- [b] --subdir installs (independent clones) ---"
node lib/cli/index.js add "file:///$COLL" --subdir skills/alpha           # name=alpha
node lib/cli/index.js add "file:///$COLL" --subdir skills/beta --name beta

echo "--- [c] list: SUBDIR column ---"
node lib/cli/index.js list

echo "--- [d] dsh-skills-nexus list + ls symlinks: only alpha-skill and beta-skill ---"
dsh-skills-nexus list
# check that symlinks were created
ls -la "$DSH_HOME/skills/"

echo "--- [e] enable/disable are per entry (= per subdir) ---"
node lib/cli/index.js disable beta && node lib/cli/index.js list
node lib/cli/index.js enable beta

echo "--- [f] remove alpha: only alpha's clone is deleted ---"
node lib/cli/index.js remove alpha && node lib/cli/index.js list

echo "--- [g] large-collection guard (21 skills) ---"
LARGE="$(cygpath -m "$TEMP/nexus-large")"
rm -rf "$LARGE"; mkdir -p "$LARGE"
for i in $(seq -w 1 21); do printf -- "---\nname: skill-$i\n---\nS\n" > "$LARGE/skill-$i.md"; done
cd "$LARGE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm large
cd "$PROJECT"
node lib/cli/index.js add "file:///$LARGE" --yes    # --yes installs all 21; ⚠ description fallback warnings are expected (see pitfall 8)
# node lib/cli/index.js list | grep nexus-large     # original: piping node in Git Bash may print "stdout is not a tty" (see pitfall 9)
node lib/cli/index.js list                          # view full output: the nexus-large row must start with on (state resolved by link target)

echo "--- [g2] multi-skill entry state lookup (disable/enable act on all links) ---"
node lib/cli/index.js disable nexus-large
# node lib/cli/index.js list | grep nexus-large     # original: same as above, may print "stdout is not a tty"
node lib/cli/index.js list                          # → nexus-large row must start with off (all links of the multi-skill entry)
ls -la "$DSH_HOME/skills/" | grep -c "skill-" || true   # → 0: all 21 links removed (old disable falsely said "already disabled")
node lib/cli/index.js enable nexus-large
# node lib/cli/index.js list | grep nexus-large     # original: same as above, may print "stdout is not a tty"
node lib/cli/index.js list                          # → nexus-large row must start with on, all 21 links restored

echo "--- [h] flat-md identity rules (docs vs real skills) ---"
MIX="$(cygpath -m "$TEMP/nexus-mix")"
rm -rf "$MIX"; mkdir -p "$MIX/sub-skill"
printf 'plain text only, no frontmatter\n' > "$MIX/plain.md"       # ❌ filtered
printf -- '---\nname: with-name\n---\nbody\n' > "$MIX/with-name.md" # ✅ has name
printf 'no frontmatter either\n' > "$MIX/sub-skill/SKILL.md"        # ✅ SKILL.md identity
cd "$MIX" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm mix
cd "$PROJECT"
node lib/cli/index.js add "file:///$MIX"
dsh-skills-nexus list
# check that symlinks were created
ls -la "$DSH_HOME/skills/"
# expected: with-name + sub-skill present, plain.md absent

# ---- cleanup ----
rm -rf "$COLL" "$DEMO" "$LARGE" "$MIX"
unset DSH_HOME
```

> `[g]` without `--yes` is interactive: it prints
> `This repository yields 21 skills… [y/N]`. Type `n` to abort (nothing
> registered) or `y` to install. In a non-TTY context the default is reject.

### Linux / macOS

Same commands with plain absolute paths (no `cygpath`):

```bash
# ---- upstream collection repo ----
COLL=/tmp/nexus-col
DEMO=/tmp/nexus-col-demo
rm -rf "$COLL" "$DEMO"
mkdir -p "$COLL/skills/alpha" "$COLL/skills/beta"
printf -- '---\nname: alpha-skill\n---\nA\n' > "$COLL/skills/alpha/SKILL.md"
printf -- '---\nname: beta-skill\n---\nB\n' > "$COLL/skills/beta/SKILL.md"
printf '# docs\n' > "$COLL/README.zh-CN.md"
printf '# board\n' > "$COLL/community-leaderboard.md"
printf '# contributing\n' > "$COLL/CONTRIBUTING.md"
cd "$COLL" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/dsh-skills-nexus                            # ← your path
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] whole-repo add: expected rejected + --subdir hint, exit=1 ---"
node lib/cli/index.js add "file://$COLL"; echo "exit=$?"

echo "--- [b] --subdir installs (independent clones) ---"
node lib/cli/index.js add "file://$COLL" --subdir skills/alpha
node lib/cli/index.js add "file://$COLL" --subdir skills/beta --name beta

echo "--- [c] list: SUBDIR column ---"
node lib/cli/index.js list

echo "--- [d] dsh-skills-nexus list + ls symlinks: only alpha-skill and beta-skill ---"
dsh-skills-nexus list
# check that symlinks were created
ls -la "$DSH_HOME/skills/"

echo "--- [e] enable/disable are per entry (= per subdir) ---"
node lib/cli/index.js disable beta && node lib/cli/index.js list
node lib/cli/index.js enable beta

echo "--- [f] remove alpha: only alpha's clone is deleted ---"
node lib/cli/index.js remove alpha && node lib/cli/index.js list

echo "--- [g] large-collection guard (21 skills) ---"
LARGE=/tmp/nexus-large
rm -rf "$LARGE"; mkdir -p "$LARGE"
for i in $(seq -w 1 21); do printf -- "---\nname: skill-$i\n---\nS\n" > "$LARGE/skill-$i.md"; done
cd "$LARGE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm large
cd "$PROJECT"
node lib/cli/index.js add "file://$LARGE" --yes      # --yes installs all 21
node lib/cli/index.js list | grep nexus-large        # row must start with on (state resolved by link target)

echo "--- [g2] multi-skill entry state lookup (disable/enable act on all links) ---"
node lib/cli/index.js disable nexus-large && node lib/cli/index.js list | grep nexus-large   # → off
ls -la "$DSH_HOME/skills/" | grep -c "skill-" || true   # → 0: all 21 links removed (old disable falsely said "already disabled")
node lib/cli/index.js enable nexus-large && node lib/cli/index.js list | grep nexus-large    # → on, all 21 links restored

echo "--- [h] flat-md identity rules (docs vs real skills) ---"
MIX=/tmp/nexus-mix
rm -rf "$MIX"; mkdir -p "$MIX/sub-skill"
printf 'plain text only, no frontmatter\n' > "$MIX/plain.md"
printf -- '---\nname: with-name\n---\nbody\n' > "$MIX/with-name.md"
printf 'no frontmatter either\n' > "$MIX/sub-skill/SKILL.md"
cd "$MIX" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm mix
cd "$PROJECT"
node lib/cli/index.js add "file://$MIX"
dsh-skills-nexus list
# check that symlinks were created
ls -la "$DSH_HOME/skills/"
# expected: with-name + sub-skill present, plain.md absent

# ---- cleanup ----
rm -rf "$COLL" "$DEMO" "$LARGE" "$MIX"
unset DSH_HOME
```

---

## What each step should print

| step | expected output | meaning |
|---|---|---|
| `[a]` whole-repo add | `No installable SKILL.md content…` + `--subdir <path>` hint, exit 1 | nested collection rejected, not "fake-installed" |
| `[b]` subdir add | `Added skill "alpha"` with `subdir: skills/alpha`, clone at `…-alpha` | independent clone per subdir, name = last segment |
| `[c]` list | `SUBDIR` column shows `skills/alpha` / `skills/beta` | entry records its subdir |
| `[d]` dsh-skills-nexus list + ls symlinks | only `alpha-skill` + `beta-skill` | root docs (README.zh-CN.md etc.) are not skills |
| `[e]` disable/enable | `beta` flips off/on, `alpha` unaffected | per-entry (= per-subdir) visibility |
| `[f]` remove | `Removed "alpha" and deleted …-alpha/`, beta stays | independent clones, zero collateral |
| `[g]` large guard | without `--yes`: prompt then abort; with `--yes`: 21 skills registered and the `list` row starts with `on` | guard works in both directions; multi-skill state resolved by link target |
| `[g2]` multi-skill toggle | after disable: `off nexus-large` and all 21 links gone; after enable: back to `on` | state lookup and toggling work for multi-skill entries |
| `[h]` flat-md rules | `with-name` + `sub-skill` listed, `plain.md` absent | no frontmatter flat md ≠ skill; SKILL.md always counts |

Note: `dsh-skills-nexus list` lists *all* entries registered in the current `$DSH_HOME`,
so after `[g]` you will also see the 21 `skill-*` entries — that is expected.

---

## Pitfalls seen in practice

1. **Same `$DSH_HOME` accumulates entries** — steps `[b]`–`[h]` share one
   demo `DSH_HOME`; later `list` outputs include earlier entries.
   That is expected; assert per-name, not total counts.
2. **`[g]` is interactive without `--yes`** — in a TTY it asks `[y/N]`; in a
   non-TTY context it defaults to reject and prints `Aborted.` (nothing
   registered). Use `--yes` for scripted runs.
3. **`--subdir` path validation** — leading `/`, `..`, or an empty segment is
   rejected before cloning. A non-existent subdir is rejected after cloning
   and the clone is cleaned up.
4. **Same repo can be installed multiple times with different `--subdir`s** —
   each install is an independent entry (name = subdir's last segment, path =
   `repo-subdir`), so re-running `add` for another subdir does not collide.
   Re-adding the *same* subdir is refused (name/path already registered).
5. **Platform paths** — Windows Git Bash: `cygpath -m` + `file:///C:/...`;
   Linux / macOS: plain absolute paths + `file:///tmp/...`.
6. **`git init -b main` needs git ≥ 2.28** — older git: `git init &&
   git symbolic-ref HEAD refs/heads/main`.
7. **Run the compiled CLI** — the walkthrough uses `lib/`; rebuild with
   `npm run build` after changing `src/`.
8. **`⚠ frontmatter description was missing` warnings during install are
   expected** — the demo fixtures carry `name` but no `description`, so
   install-time normalization fills in a fallback (matching the
   `normalized: N frontmatter field(s)` line in the output). Not an error.
9. **Git Bash pipes may print `stdout is not a tty`** — in an interactive
   Windows Git Bash session, piping the output of the native Windows
   `node.exe` can print this message. It is a known mintty tty-compat
   quirk, not a tool failure (the data was already written). Workarounds:
   run `node lib/cli/index.js list` without a pipe and read the full
   output, or redirect first: `node lib/cli/index.js list > /tmp/l.txt &&
   grep nexus-large /tmp/l.txt`. MSYS-native programs (e.g. `ls | grep`)
   are unaffected.

---

## Coverage boundaries

- **Real GitHub network** — local `file://` remotes simulate the same git
  semantics without network flakiness. A real run against
  `trae-community/trae-skills` should behave identically (12 skills under
  `skills/`, root docs filtered).
- **P2 shared-clone design** — not implemented (v1 is independent clones);
  see [docs/subdir-design.md](docs/subdir-design.md) for the trade-off and the
  two hidden pitfalls (shared-ref identity, lock ownership).
- **DSH runtime integration** — Skills are now exposed via symlinks in ~/.dsh/skills/ and discovered by the official filesystem provider. No custom provider registration is needed. `subdir` is a new optional manifest field (old manifests load fine).
- **Node 20 / 22 / 24 matrix** — CI runs the full gate set on push/PR.

# Verifying group operations (toggle --group / remove --group)

This guide verifies the **group operations** that batch-enable, batch-disable,
or batch-delete entries by their `groupPath` prefix — channel E of
[sources-and-packages.md](sources-and-packages.md):

- **`enable --group <path>`** / **`disable --group <path>`** — toggle every
  entry whose `groupPath` matches the prefix segment by segment.
- **`remove --group <path>`** — delete every matching entry (symlink +
  manifest record; external directories are preserved).

Both commands share the same **segment-exact** matching rule: the prefix is
split on `/` and compared path-segment by path-segment. A joined-string
`startsWith` would let `trae-cn/skill` (missing the final `s`) match every
`trae-cn/skills/*` entry; the segment-exact rule prevents this.

Everything below is safe: nothing touches your real `~/.dsh` or `~/.trae-cn`,
no network is contacted, and all temporary state lives under dedicated temp
dirs you delete at the end.

## Prerequisites

- Node.js >= 18 and git on `PATH`
- Repo checked out and `npm install` done
- If you changed `src/`, run `npm run build` first — the walkthrough runs the
  compiled CLI from `lib/`

---

## Part 1 — test suite (quality gates)

```bash
npm run typecheck     # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run lint          # ESLint 9 + typescript-eslint
npm test              # node:test + tsx — expected: all tests pass
npm run build         # tsc -> lib/
```

Relevant test coverage:

| test file | what it verifies |
|---|---|
| `test/toggle-group.test.ts` | segment-exact prefix match; sub-group isolation (`trae-cn/skills` does not touch `trae-cn/builtin_skills`); empty-group error (human + JSON); name intersection (`--group <path> <name>`); already-in-that-state idempotency; managed entries (no `groupPath`) are invisible to `--group` |
| `test/remove-group.test.ts` | batch deletion with external directory preservation; segment boundary; mutual exclusion with name patterns (exit 2); empty group (human exit 1, JSON exit 1 with `summary.failed: 1`); non-TTY refusal (exit 2); interactive confirm + abort; `--yes` skip; single-match needs no `--yes` |
| `test/api.test.ts` | HTTP toggle route segment-exact match (`trae-cn/skill` → 404, `trae-cn/skills` → 200); name+group ambiguity (400) |
| `test/args.test.ts` | `parseRemoveArgs --group` with separate value, inline `--group=`, and empty-value rejection |
| `test/completions.test.ts` | all four templates offer `--group` in the `remove` branch |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.

The fixture creates a fake trae-cn directory with six skills across two
sub-groups (`skills/` and `builtin_skills/`), then uses `link trae-cn
--trae-cn-dir` to register them as external entries — no real `~/.trae-cn` is
touched.

### Windows (Git Bash / MINGW64)

```bash
PROJECT=~/Downloads/dsh-skills-nexus                  # <- your path
TROOT="$(cygpath -m "$TEMP")/nexus-group-ops"
rm -rf "$TROOT"
mkdir -p "$TROOT"

# ---- fake trae-cn directory: 4 skills + 2 builtin_skills ----
TRAECN="$TROOT/trae-cn"
for d in skills/alpha skills/beta skills/gamma skills/delta \
         builtin_skills/review builtin_skills/debug; do
  name=$(echo "$d" | tr '/' '.')
  mkdir -p "$TRAECN/$d"
  printf -- "---\nname: trae-cn.%s\ndescription: %s\n---\nBody\n" \
    "$name" "$name" > "$TRAECN/$d/SKILL.md"
done

export DSH_HOME="$TROOT/home"
cd "$PROJECT"

echo "--- [a] link the fake trae-cn directory ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN"
node lib/cli/index.js list --names
# expected: 6 names, all on

echo "--- [b] disable the skills sub-group ---"
node lib/cli/index.js disable --group trae-cn/skills
node lib/cli/index.js list
# expected: 4 skills/* entries off; 2 builtin_skills/* entries still on

echo "--- [c] re-enable the skills sub-group ---"
node lib/cli/index.js enable --group trae-cn/skills
node lib/cli/index.js list
# expected: all 6 on again

echo "--- [d] segment boundary: 'trae-cn/skill' must NOT match 'trae-cn/skills/*' ---"
node lib/cli/index.js disable --group trae-cn/skill; echo "exit=$?"
# expected: exit=1, "no entries match group"
node lib/cli/index.js list
# expected: all 6 still on (nothing was toggled)

echo "--- [e] remove the skills sub-group (with --yes to skip confirm) ---"
node lib/cli/index.js remove --group trae-cn/skills --yes
node lib/cli/index.js list --names
# expected: only trae-cn.builtin_skills.review and trae-cn.builtin_skills.debug

echo "--- [f] external directories survive removal ---"
ls "$TRAECN/skills/alpha/SKILL.md" 2>/dev/null && echo "user dir preserved" || echo "USER DIR LOST"
# expected: "user dir preserved" — remove never deletes the user's source dir

echo "--- [g] remove the rest with the L1 group ---"
node lib/cli/index.js remove --group trae-cn --yes
node lib/cli/index.js list --names
# expected: empty (no entries)

echo "--- [h] empty group is an error, not an empty success ---"
node lib/cli/index.js remove --group trae-cn --yes; echo "exit=$?"
# expected: exit=1, "no entries match group"

echo "--- [i] mutual exclusion: --group + name → usage error ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN" >/dev/null
node lib/cli/index.js remove --group trae-cn alpha; echo "exit=$?"
# expected: exit=2, "--group cannot be combined with name patterns"

echo "--- [j] cleanup ---"
rm -rf "$TROOT"
unset DSH_HOME
```

### Linux / macOS

Same commands with plain absolute paths (no `cygpath`):

```bash
PROJECT=~/dsh-skills-nexus                            # <- your path
TROOT=/tmp/nexus-group-ops
rm -rf "$TROOT"
mkdir -p "$TROOT"

TRAECN="$TROOT/trae-cn"
for d in skills/alpha skills/beta skills/gamma skills/delta \
         builtin_skills/review builtin_skills/debug; do
  name=$(echo "$d" | tr '/' '.')
  mkdir -p "$TRAECN/$d"
  printf -- "---\nname: trae-cn.%s\ndescription: %s\n---\nBody\n" \
    "$name" "$name" > "$TRAECN/$d/SKILL.md"
done

export DSH_HOME="$TROOT/home"
cd "$PROJECT"

echo "--- [a] link the fake trae-cn directory ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN"
node lib/cli/index.js list --names

echo "--- [b] disable the skills sub-group ---"
node lib/cli/index.js disable --group trae-cn/skills
node lib/cli/index.js list

echo "--- [c] re-enable the skills sub-group ---"
node lib/cli/index.js enable --group trae-cn/skills
node lib/cli/index.js list

echo "--- [d] segment boundary: 'trae-cn/skill' must NOT match 'trae-cn/skills/*' ---"
node lib/cli/index.js disable --group trae-cn/skill; echo "exit=$?"
node lib/cli/index.js list

echo "--- [e] remove the skills sub-group ---"
node lib/cli/index.js remove --group trae-cn/skills --yes
node lib/cli/index.js list --names

echo "--- [f] external directories survive removal ---"
ls "$TRAECN/skills/alpha/SKILL.md" 2>/dev/null && echo "user dir preserved" || echo "USER DIR LOST"

echo "--- [g] remove the rest with the L1 group ---"
node lib/cli/index.js remove --group trae-cn --yes
node lib/cli/index.js list --names

echo "--- [h] empty group is an error ---"
node lib/cli/index.js remove --group trae-cn --yes; echo "exit=$?"

echo "--- [i] mutual exclusion: --group + name → usage error ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN" >/dev/null
node lib/cli/index.js remove --group trae-cn alpha; echo "exit=$?"

echo "--- [j] cleanup ---"
rm -rf "$TROOT"
unset DSH_HOME
```

---

## What each step should print

| step | expected output | meaning |
|---|---|---|
| `[a]` link | `Linked 6 skill(s) from trae-cn`; list shows 6 names, all on | external entries created with `groupPath` |
| `[b]` disable sub-group | 4 `Disabled "trae-cn.skills.*"` lines; list: 4 off, 2 on | segment-exact: `trae-cn/skills` matches only the skills sub-group |
| `[c]` enable sub-group | 4 `Enabled "trae-cn.skills.*"` lines; all 6 on | toggle is reversible |
| `[d]` segment boundary | exit=1, `no entries match group "trae-cn/skill"`; all 6 still on | `trae-cn/skill` (missing `s`) does NOT match `trae-cn/skills/*` |
| `[e]` remove sub-group | 4 `Removed "trae-cn.skills.*"` lines; list: 2 builtin remain | batch deletion scoped to sub-group |
| `[f]` directory check | `user dir preserved` | external entries preserve the user's source directory |
| `[g]` remove L1 group | 2 `Removed "trae-cn.builtin_skills.*"` lines; list: empty | `trae-cn` matches all sub-groups |
| `[h]` empty group | exit=1, `no entries match group "trae-cn"` | empty group is an error, not a silent success |
| `[i]` mutual exclusion | exit=2, `--group cannot be combined with name patterns` | usage error, nothing deleted |

---

## Pitfalls seen in practice

1. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.
2. **`--trae-cn-dir` is required** — without it, `link trae-cn` looks at
   `~/.trae-cn` (which may not exist on the test machine). The flag overrides
   the default root.
3. **Segment-exact vs string prefix** — the old `startsWith` bug let
   `trae-cn/skill` match `trae-cn/skills/*`. Step `[d]` verifies this cannot
   happen. If you see all 6 entries toggled at step `[d]`, the fix is not in
   effect.
4. **External entries never delete user directories** — step `[f]` checks this.
   `remove --group` only unregisters the manifest entry and removes the
   symlink; the user's source directory is preserved.
5. **Managed entries are invisible to `--group`** — they have no `groupPath`,
   so group operations only affect entries created by `link` (external
   entries). This is by design.
6. **Confirmation guard** — without `--yes`, a group matching multiple entries
   prompts on a TTY and refuses on a non-TTY (exit 2). The walkthrough uses
   `--yes` throughout for scriptability; interactive use should see the prompt.
7. **`git init -b main` needs git >= 2.28** — not used in this walkthrough
   (the fixture creates plain directories, not git repos), but relevant if you
   extend the fixture with `add` entries.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **HTTP toggle route** — the panel's `POST /skills-nexus/toggle` with group
  mode uses the same segment-exact rule; `test/api.test.ts` covers it. The
  walkthrough exercises the CLI that shares the same matching logic.
- **Panel group UI** — the panel's group Switch and reconcile predicate use
  the same rule; `test/panel-render.test.ts` covers the rendering.
- **`remove --group` confirmation prompt** — the walkthrough uses `--yes` for
  scriptability. The interactive confirm path is covered by
  `test/remove-group.test.ts` (confirm true → proceed; confirm false → abort).
- **JSON output shape** — `test/remove-group.test.ts` asserts the version-1
  machine report for empty groups (`results: []`, `summary.failed: 1`,
  exit 1). The walkthrough uses human output.
- **Node 20 / 22 / 24 matrix** — CI runs the full quality-gate set on push/PR.

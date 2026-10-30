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

For Trae / Trae CN source selection, generic root overrides, and panel acceptance,
see [Verifying local source links](verify-link-sources.md). This group walkthrough
retains `--trae-cn-dir` as a backward-compatibility example; new commands can use
`--source-dir` with either source.

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
| `test/toggle-group.test.ts` | segment-exact prefix match; sub-group isolation (`trae-cn/skills` does not touch the seeded second sub-group); empty-group error (human + JSON); name intersection (`--group <path> <name>`); already-in-that-state idempotency; managed entries (no `groupPath`) are invisible to `--group` |
| `test/remove-group.test.ts` | batch deletion with external directory preservation; segment boundary; mutual exclusion with name patterns (exit 2); empty group (human exit 1, JSON exit 1 with `summary.failed: 1`); non-TTY refusal (exit 2); interactive confirm + abort; `--yes` skip; single-match needs no `--yes` |
| `test/api.test.ts` | HTTP toggle route segment-exact match (`trae-cn/skill` → 404, `trae-cn/skills` → 200); name+group ambiguity (400) |
| `test/args.test.ts` | `parseRemoveArgs --group` with separate value, inline `--group=`, and empty-value rejection |
| `test/completions.test.ts` | all four templates offer `--group` in the `remove` branch |

---

## Part 2 — end-to-end walkthrough

One copy-paste block per platform. Replace `PROJECT` with your checkout path.

The fixture creates a fake trae-cn directory with six skills across two
sub-groups — four under `skills/` (registered with `link trae-cn
--trae-cn-dir`) and two under `vendor_skills/` (seeded by hand — manifest entry
plus symlink: the link channel only scans `skills/`, so a second sub-group can
no longer arrive via `link`). No real `~/.trae-cn` is touched.

### Windows (Git Bash / MINGW64)

```bash
PROJECT=~/Downloads/dsh-skills-nexus                  # <- your path
TROOT="$(cygpath -m "$TEMP")/nexus-group-ops"
rm -rf "$TROOT"
mkdir -p "$TROOT"

# ---- fake trae-cn directory: 4 skills + 2 vendor_skills ----
TRAECN="$TROOT/trae-cn"
for d in skills/alpha skills/beta skills/gamma skills/delta \
         vendor_skills/review vendor_skills/debug; do
  name=$(echo "$d" | tr '/' '.')
  mkdir -p "$TRAECN/$d"
  printf -- "---\nname: trae-cn.%s\ndescription: %s\n---\nBody\n" \
    "$name" "$name" > "$TRAECN/$d/SKILL.md"
done

export DSH_HOME="$TROOT/home"
cd "$PROJECT"

echo "--- [a] link the fake trae-cn directory ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN"
# link scans skills/ only — the 2 vendor_skills entries are seeded directly.
# Mirror linkLocal's two steps (manifest entry + symlink): a manifest-only
# entry has no link, so `list` reports it as off and step [b] loses its
# "4 off / 2 on" signal.
TRAECN="$TRAECN" node --input-type=module <<'EOF'
import('./lib/manifest.js').then(async (m) => {
  const { join } = await import('node:path');
  const link = await import('./lib/link.js');
  const trae = process.env.TRAECN;
  for (const s of ['review', 'debug']) {
    const dir = join(trae, 'vendor_skills', s);
    const name = `trae-cn.vendor_skills.${s}`;
    await m.addEntry({
      name,
      url: `trae-cn:vendor_skills/${s}`,
      gitUrl: '', ref: '',
      ownership: 'external', path: dir,
      addedAt: new Date().toISOString(),
      externalDir: dir,
      groupPath: ['trae-cn', 'vendor_skills', s],
    });
    await link.linkSkill(name, dir);
  }
});
EOF
node lib/cli/index.js list --names
# expected: 6 names, all on

echo "--- [b] disable the skills sub-group ---"
node lib/cli/index.js disable --group trae-cn/skills
node lib/cli/index.js list
# expected: 4 skills/* entries off; 2 vendor_skills/* entries still on

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
# expected: only trae-cn.vendor_skills.review and trae-cn.vendor_skills.debug

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
         vendor_skills/review vendor_skills/debug; do
  name=$(echo "$d" | tr '/' '.')
  mkdir -p "$TRAECN/$d"
  printf -- "---\nname: trae-cn.%s\ndescription: %s\n---\nBody\n" \
    "$name" "$name" > "$TRAECN/$d/SKILL.md"
done

export DSH_HOME="$TROOT/home"
cd "$PROJECT"

echo "--- [a] link the fake trae-cn directory ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN"
# link scans skills/ only — the 2 vendor_skills entries are seeded directly.
# Mirror linkLocal's two steps (manifest entry + symlink): a manifest-only
# entry has no link, so `list` reports it as off and step [b] loses its
# "4 off / 2 on" signal.
TRAECN="$TRAECN" node --input-type=module <<'EOF'
import('./lib/manifest.js').then(async (m) => {
  const { join } = await import('node:path');
  const link = await import('./lib/link.js');
  const trae = process.env.TRAECN;
  for (const s of ['review', 'debug']) {
    const dir = join(trae, 'vendor_skills', s);
    const name = `trae-cn.vendor_skills.${s}`;
    await m.addEntry({
      name,
      url: `trae-cn:vendor_skills/${s}`,
      gitUrl: '', ref: '',
      ownership: 'external', path: dir,
      addedAt: new Date().toISOString(),
      externalDir: dir,
      groupPath: ['trae-cn', 'vendor_skills', s],
    });
    await link.linkSkill(name, dir);
  }
});
EOF
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
| `[a]` link | `Linked 4 skill(s) from trae-cn`; list shows 6 names, all on | external entries created with `groupPath` (2 seeded directly) |
| `[b]` disable sub-group | 4 `Disabled "trae-cn.skills.*"` lines; list: 4 off, 2 on | segment-exact: `trae-cn/skills` matches only the skills sub-group |
| `[c]` enable sub-group | 4 `Enabled "trae-cn.skills.*"` lines; all 6 on | toggle is reversible |
| `[d]` segment boundary | exit=1, `no entries match group "trae-cn/skill"`; all 6 still on | `trae-cn/skill` (missing `s`) does NOT match `trae-cn/skills/*` |
| `[e]` remove sub-group | 4 `Removed "trae-cn.skills.*"` lines; list: 2 vendor remain | batch deletion scoped to sub-group |
| `[f]` directory check | `user dir preserved` | external entries preserve the user's source directory |
| `[g]` remove L1 group | 2 `Removed "trae-cn.vendor_skills.*"` lines; list: empty | `trae-cn` matches all sub-groups |
| `[h]` empty group | exit=1, `no entries match group "trae-cn"` | empty group is an error, not a silent success |
| `[i]` mutual exclusion | exit=2, `--group cannot be combined with name patterns` | usage error, nothing deleted |

---

## Pitfalls seen in practice

1. **Run the compiled CLI** — the walkthrough uses `lib/`; after changing
   `src/`, rebuild with `npm run build` first.
2. **Explicitly select the fixture root** — this walkthrough uses the compatible
   `--trae-cn-dir "$TRAECN"`; `--source-dir "$TRAECN"` is equivalent and takes
   precedence if both are supplied. Without an override, `link trae-cn` uses
   `TRAE_CN_DIR` or `~/.trae-cn`. Do not omit the override in this walkthrough.
3. **`link` only scans `skills/`** — a second sub-group (`vendor_skills/` here)
   is never picked up by `link`; it must be seeded by hand, as step `[a]` does —
   and that means **both** the manifest entry and the symlink. A hand-written
   manifest entry alone has no link, so `list` reports it as `off` and step `[b]`
   stops distinguishing the two sub-groups. If step `[a]` lists only 4 names,
   the seeding snippet did not run.
4. **Segment-exact vs string prefix** — the old `startsWith` bug let
   `trae-cn/skill` match `trae-cn/skills/*`. Step `[d]` verifies this cannot
   happen. If you see all 6 entries toggled at step `[d]`, the fix is not in
   effect.
5. **External entries never delete user directories** — step `[f]` checks this.
   `remove --group` only unregisters the manifest entry and removes the
   symlink; the user's source directory is preserved.
6. **Managed entries are invisible to `--group`** — they have no `groupPath`,
   so group operations only affect entries created by `link` (external
   entries). This is by design.
7. **Confirmation guard** — without `--yes`, a group matching multiple entries
   prompts on a TTY and refuses on a non-TTY (exit 2). The walkthrough uses
   `--yes` throughout for scriptability; interactive use should see the prompt.
8. **`git init -b main` needs git >= 2.28** — not used in this walkthrough
   (the fixture creates plain directories, not git repos), but relevant if you
   extend the fixture with `add` entries.

---

## Coverage boundaries

What this guide does *not* cover (by design):

- **HTTP toggle route** — the panel's `POST /skills-nexus/toggle` with group
  mode uses the same segment-exact rule; `test/api.test.ts` covers it. The
  walkthrough exercises the CLI that shares the same matching logic.
- **Panel group UI** — the panel's group Switch and reconcile predicate use
  the same rule; `test/panel-render.test.ts` covers the rendering. Folding a
  group header is pure view state: it changes which rows are on screen, never
  the group's match rule, nor what the group Switch and `remove group` act on.
- **`remove --group` confirmation prompt** — the walkthrough uses `--yes` for
  scriptability. The interactive confirm path is covered by
  `test/remove-group.test.ts` (confirm true → proceed; confirm false → abort).
- **JSON output shape** — `test/remove-group.test.ts` asserts the version-1
  machine report for empty groups (`results: []`, `summary.failed: 1`,
  exit 1). The walkthrough uses human output.
- **Node 20 / 22 / 24 matrix** — CI runs the full quality-gate set on push/PR.

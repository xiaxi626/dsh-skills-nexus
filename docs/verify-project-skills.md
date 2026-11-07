# Verifying project-scope skills

[简体中文](verify-project-skills.zh-CN.md)

> **Shell warning:** the `bash` blocks below are for Windows Git Bash or Linux/macOS Bash, not PowerShell/cmd. Open a terminal at this checkout's root and run each block as a whole. The script never changes directories except inside a subshell, and it uses an isolated `DSH_HOME`.

Project scope manages the skills a project carries with it: links under `<projectRoot>/.dsh/skills`, the directory the DSH filesystem provider scans **before** the user-level root. A link there shadows a global skill of the same name, and nexus does not need a manifest, a clone or a copy to make it visible — the provider follows the link.

This guide verifies:

- `list --project`, `link --project <dir>`, `remove --project <name>...` and `doctor --project`;
- `list --all`, the human-only joined view with `overrides` / `shadowed` markers;
- the three HTTP routes and the panel section;
- the invariants: **no manifest write, no copy or clone, and never a user-file deletion**.

## What project scope is and is not

| | Global (default) | Project scope (`--project`) |
|---|---|---|
| Entry location | `~/.dsh/skills/<name>` | `<projectRoot>/.dsh/skills/<name>` |
| Target | a nexus clone, or an external directory | any directory the user names |
| State | `manifest.json` records source/version/ownership | **none** — the filesystem is the truth |
| Commands | the full lifecycle | `list` / `link` / `remove` / `doctor` only |
| Writes | manifest, clones, links | links only |

Not available with `--project`: `add`, `import`, `update`, `export`, `enable`, `disable`. `remove --project` takes exact link names only (no globs, no `--group`).

## Prerequisites and the two builds

- Node.js >= 20 and git on `PATH`; on Windows use Git Bash.
- Project dependencies installed at the checkout root.
- `npm run build` compiles the CLI/server half. `npm run build:client` separately produces `lib/client.js` and `lib/client-types/`; the panel section only changes when you run it.

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  npm run build
  npm run build:client
  npm run typecheck
  npm run lint
  npm run test:build
)
```

Every command should exit 0. To check committed artifact freshness, run `git diff --exit-code -- lib/`. Do not hand-edit generated files.

## Automated regression tests

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  node --import tsx --import ./test/register-css.mjs --test \
    test/project.test.ts test/cli-project.test.ts \
    test/args.test.ts test/api.test.ts test/client-api.test.ts \
    test/panel-render.test.tsx test/completions.test.ts
)
```

| Test file | Coverage |
|---|---|
| `project.test.ts` | `detectProjectRoot` (directory and file `.git`, fallback to cwd); listing (empty root, link, user files, dangling link with recovered target); name derivation for the three layouts and the non-ASCII fallback; `replace` / `unchanged` / `collision` / duplicate-name plans; apply and re-plan; removal refusing real directories; path-traversal rejection; the Windows UNC refusal |
| `cli-project.test.ts` | The process-level chain: cwd root detection, `link --project` → `list --project` → `remove --project`, JSON purity, exit codes, no manifest created, user files refused, dangling `doctor` warning, `list --all`, bad explicit root, registry flags rejected, UNC refused |
| `args.test.ts` | `--project` / `--project-root` / `--all` parsing, the "root requires project" rule, mutual exclusions, project-mode flag/glob refusals |
| `api.test.ts` | The three routes: root validation, loopback and origin guards, preview vs `202` job, `confirm-required`, `404 not-found`, `409 not-a-link`, `400 invalid-name`, UNC refusal |
| `client-api.test.ts` | `projectList` URL encoding, `projectLink` preview/job bodies, `projectRemove` confirm flag |
| `panel-render.test.tsx` | The project section renders its root input and gated form; a `link` row has `remove`, a `user files` row never does; a dangling row shows the `dangling` badge |
| `completions.test.ts` | `--project` / `--project-root` / `--all` offered by all four templates; the `--project-root` value is skipped when counting positionals |

## Isolated CLI walkthrough

The script builds a temporary project (with a `.git` marker), two source skill directories and an isolated `DSH_HOME`, then drives every project command. It prints one `PASS` line per checkpoint and `cleaned` at the end.

```bash
(
  set -e
  PROJECT="$(pwd)"
  BASE="${TMPDIR:-/tmp}/nexus-project-verify-$$"
  if command -v cygpath >/dev/null 2>&1; then BASE="$(cygpath -m "$BASE")"; fi
  export DSH_HOME="$BASE/home"
  PROJ="$BASE/proj"
  SRC="$BASE/src/my-skill"
  SRC2="$BASE/src/second-skill"
  nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }
  expect_fail() { if "$@" >/dev/null 2>&1; then echo "FAIL: expected a non-zero exit: $*"; exit 1; fi; }

  rm -rf "$BASE"
  mkdir -p "$PROJ/.git" "$SRC" "$SRC2"
  printf -- '---\nname: my-skill\ndescription: demo\n---\n# my-skill\n' > "$SRC/SKILL.md"
  printf -- '---\nname: second-skill\ndescription: demo\n---\n# second-skill\n' > "$SRC2/SKILL.md"

  # S1) an empty project lists cleanly
  nexus list --project --project-root "$PROJ" | grep -q 'No project skills in'
  echo 'PASS S1 empty project lists cleanly'

  # S2) link a directory into <project>/.dsh/skills
  nexus link --project "$SRC" --project-root "$PROJ" --json > "$BASE/link.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.version!==1||r.results[0].status!=="link"||r.summary.linked!==1){console.error(r);process.exit(1)}' "$BASE/link.json"
  test -d "$PROJ/.dsh/skills/my-skill"
  echo 'PASS S2 link --project creates the project link'

  # S3) list --project reports kind/target, in both shapes
  nexus list --project --project-root "$PROJ" --json > "$BASE/list.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.entries.length!==1||r.entries[0].kind!=="link"||r.entries[0].dangling!==false){console.error(r);process.exit(1)}' "$BASE/list.json"
  nexus list --project --project-root "$PROJ" | grep -q '^link  my-skill'
  echo 'PASS S3 list --project reports KIND / NAME / TARGET'

  # S4) user files are reported but never deleted
  mkdir -p "$PROJ/.dsh/skills/vendored"
  printf -- '---\nname: vendored\n---\n' > "$PROJ/.dsh/skills/vendored/SKILL.md"
  expect_fail nexus remove --project vendored --project-root "$PROJ"
  test -f "$PROJ/.dsh/skills/vendored/SKILL.md"
  echo 'PASS S4 remove --project refuses user files'

  # S5) a deleted target makes the link dangling, and doctor warns
  nexus link --project "$SRC2" --project-root "$PROJ" --json > /dev/null
  rm -rf "$SRC2"
  nexus doctor --project --project-root "$PROJ" --json > "$BASE/doctor.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const c=r.checks[0]; if(c.id!=="project-links"||c.status!=="warn"||r.summary.warnings!==1){console.error(r);process.exit(1)}' "$BASE/doctor.json"
  echo 'PASS S5 doctor --project warns about a dangling link'

  # S6) removing the dangling link cleans it up
  nexus remove --project second-skill --project-root "$PROJ" --json > "$BASE/remove.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.results[0].status!=="removed"){console.error(r);process.exit(1)}' "$BASE/remove.json"
  test ! -e "$PROJ/.dsh/skills/second-skill"
  echo 'PASS S6 remove --project deletes only the link'

  # S7) list --all joins both scopes from the project cwd
  ( cd "$PROJ" && node "$PROJECT/lib/cli/index.js" list --all ) | grep -q 'project root:'
  echo 'PASS S7 list --all joins project and global scopes'

  # S8) invariants and project-only flags
  test ! -f "$DSH_HOME/skills-nexus/manifest.json"
  test -f "$SRC/SKILL.md"
  expect_fail nexus link --project "$SRC" --project-root "$PROJ" --force
  expect_fail nexus list --project-root "$PROJ"
  echo 'PASS S8 no manifest, target intact, project-only flags rejected'

  rm -rf "$BASE"
  echo 'cleaned'
)
```

Expected tail:

```text
PASS S1 empty project lists cleanly
PASS S2 link --project creates the project link
PASS S3 list --project reports KIND / NAME / TARGET
PASS S4 remove --project refuses user files
PASS S5 doctor --project warns about a dangling link
PASS S6 remove --project deletes only the link
PASS S7 list --all joins project and global scopes
PASS S8 no manifest, target intact, project-only flags rejected
cleaned
```

Notes on platform behavior:

- On Windows the link is an NTFS junction; `test -d` follows it, and `remove --project` deletes the junction without touching the target.
- A UNC source (`\\server\share\...`) is refused on Windows before any filesystem call, with a message that says junctions need a local absolute path. The walkthrough's sources are local, so this guard is covered by the focused tests rather than the script.
- On POSIX the same steps exercise plain directory symlinks; a dangling symlink is recoverable through `readlink`, which is what lets `list --project` show its old target.

## Panel acceptance checklist

Requires a DSH **web** host with the plugin mounted (see [Local testing steps](../README.md#local-testing-steps)). Static rendering is covered by the test suite; the checklist below is the UI integration gate.

1. Open **Settings → Skills Nexus**. The section has two tabs: **Global skills** (the default) and **Project skills**.
2. Switch to **Project skills**. With the project root field empty, the tab says `enter the project root to list its skills`, and **no request** is sent.
3. Enter the temporary project's absolute path, press **refresh**. An empty `.dsh/skills` shows `no project skills yet — link a directory below.`
4. Paste a skill directory path, press **preview**. The plan lists one row per discovered skill with the planned status (`link` / `replace` / `unchanged` / `collision` / `invalid`). Nothing is on disk yet.
5. Press **link to project**. The job runs and the list refreshes with a `link` badge and the absolute target.
6. Remove the target directory, press **refresh** again: the row turns into a `dangling` badge (warning tone).
7. A real directory you placed in `.dsh/skills` shows a `user files` badge and **no remove button**.
8. Press **remove** on a link row: the confirmation overlay says only the link is deleted; after confirming, the row disappears and the target directory still exists.
9. Change the project root: the old list is cleared immediately (no stale rows from the previous project).

## HTTP surface

The panel talks to three routes; they are internal plumbing, not the stable machine interface (that is the CLI `--json` reports).

| Route | Body / query | Answer |
|---|---|---|
| `GET /skills-nexus/project/list` | `?root=<absolute path>` | `{ projectRoot, entries }` |
| `POST /skills-nexus/project/link` | `{ root, dir }` | synchronous plan `{ projectRoot, source, results }` |
| `POST /skills-nexus/project/link` | `{ root, dir, confirm: true }` | `202 { data: { jobId } }`; poll `GET /job?id=` |
| `POST /skills-nexus/project/remove` | `{ root, name, confirm: true }` | `{ projectRoot, name, status: 'removed' }` |

All three require same-origin and a loopback socket. A `root` that is not an existing directory answers `400 invalid-root`; a name with a path separator answers `400 invalid-name`; a real directory or file answers `409 not-a-link`; a missing route input answers `400 missing-field`; a UNC source on Windows answers `400 unsupported-source`.

## Known boundaries

- **No state.** There is no `projectRoot` in the manifest, no migration and no "stale project" failure class. The folder is the record.
- **Links are machine-local.** They store an absolute path; committing `.dsh/skills/` links is meaningless for teammates (and Git on Windows may walk a junction as a directory). Add `.dsh/skills/` to `.gitignore` for the link-only workflow; vendored real directories are the shareable form.
- **Names come from directories.** A skill is keyed by its directory name, not its frontmatter `name`, because that is how the provider identifies it. A directory with no usable ASCII name falls back to the frontmatter name; only when both fail is the entry `invalid`.
- **Exact-name removal.** `remove --project` accepts names, not globs or group prefixes; the refusal is deliberate, to keep the destructive surface one link wide.
- **`list --all` is human-only.** It joins two datasets (filesystem links and manifest entries) and is not part of the version-1 JSON contract; use `list --json` and `list --project --json` for machines.
- **Windows junction targets.** A junction needs a local absolute path; UNC shares are refused up front instead of surfacing a raw `EPERM`.
- **The panel root is typed.** This client context injects only `slots`, with no workspace service to read a project root from, so the field is per-session and not persisted.

For the full command and option surface, see [Project skills](../README.md#project-skills) in the README.

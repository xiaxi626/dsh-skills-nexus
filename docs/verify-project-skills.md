# Verifying project-scope skills

[简体中文](verify-project-skills.zh-CN.md)

> **Shell warning:** the `bash` blocks below are for Windows Git Bash or Linux/macOS Bash, not PowerShell/cmd. Open a terminal at this checkout's root and run each block as a whole. The script never changes directories except inside a subshell, and it uses an isolated `DSH_HOME`.

Project scope manages the skills a project carries with it: links under `<projectRoot>/.dsh/skills`, the directory the DSH filesystem provider scans **before** the user-level root. A link there shadows a global skill of the same name, and nexus does not need a manifest, a clone or a copy to make it visible — the provider follows the link.

This guide verifies:

- `list --project`, `link --project <dir>`, `remove --project <name>...` and `doctor --project`;
- `enable --project` / `disable --project` for links, and the `--files` variant that moves a real directory between `.dsh/skills` and `.dsh/skills-disabled`;
- the registered-workspace block: `GET /workspaces/list`, `GET /workspace/skills`, `POST /workspace/toggle`;
- `list --all`, the human-only joined view with `overrides` / `shadowed` markers;
- the four routes of the manual project folder and the panel section;
- the invariants: **no manifest write, no copy or clone, and never a user-file deletion**.

## What project scope is and is not

| | Global (default) | Project scope (`--project`) |
|---|---|---|
| Entry location | `~/.dsh/skills/<name>` | `<projectRoot>/.dsh/skills/<name>` |
| Target | a nexus clone, or an external directory | any directory the user names |
| State | `manifest.json` records source/version/ownership | **none** — the filesystem is the truth |
| Commands | the full lifecycle | `list` / `link` / `remove` / `doctor` / `enable` / `disable` |
| Writes | manifest, clones, links | links, or a `rename` of a real directory in `--files` mode |

Not available with `--project`: `add`, `import`, `update`, `export`. `remove --project` takes exact link names only (no globs, no `--group`), and so do `enable` / `disable`; `--files` additionally refuses `--group`, because both target exact names.

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
    test/project.test.ts test/project-files.test.ts \
    test/cli-project.test.ts \
    test/workspaces.test.ts test/workspace-routes.test.ts \
    test/args.test.ts test/api.test.ts test/client-api.test.ts \
    test/panel-render.test.tsx test/panel-workspaces.test.tsx \
    test/completions.test.ts
)
```

| Test file | Coverage |
|---|---|
| `project.test.ts` | `detectProjectRoot` (directory and file `.git`, fallback to cwd); listing (empty root, link, user files, dangling link with recovered target); name derivation for the three layouts and the non-ASCII fallback; `replace` / `unchanged` / `collision` / duplicate-name plans; apply and re-plan; removal refusing real directories; path-traversal rejection; the Windows UNC refusal |
| `project-files.test.ts` | `setProjectFilesEnabled` / `listProjectFiles`: disable → enable round trip, `already-*` verdicts, `not-found`, path-traversal rejection, the same name tracked independently in both roots, `collision` when the other root is occupied |
| `cli-project.test.ts` | The process-level chain: cwd root detection, `link --project` → `list --project` → `remove --project`, JSON purity, exit codes, no manifest created, user files refused, dangling `doctor` warning, `list --all`, bad explicit root, registry flags rejected, UNC refused, `--files` moving a real directory while refusing a link |
| `workspaces.test.ts` | `workspaceRegistryOf` on a missing/odd `ctx`; `listWorkspaces` row normalisation; `resolveWorkspaceTarget` refusing absolute paths, unregistered paths, missing rows and symlinked `.dsh` levels |
| `workspace-routes.test.ts` | The three routes through a fake request/response: unavailability answers, the `workspace` query, toggle bodies, error status mapping |
| `args.test.ts` | `--project` / `--project-root` / `--all` / `--files` parsing, the "root requires project" rule, `--files` requiring `--project`, mutual exclusions, project-mode flag/glob refusals |
| `api.test.ts` | The four manual-folder routes: root validation, loopback and origin guards, preview vs `202` job, `confirm-required`, toggle, `404 not-found`, `409 not-a-link`/`collision`, `400 invalid-name`, UNC refusal |
| `client-api.test.ts` | `projectList` URL encoding, `projectLink` preview/job bodies, `projectRemove` confirm flag |
| `panel-render.test.tsx` | The project section renders its root input and gated form; a `link` row has `remove`, a `user files` row never does; a dangling row shows the `dangling` badge |
| `panel-workspaces.test.tsx` | The registered-workspace block comes first with an `<hr/>` divider, the manual block and its hint are unchanged, and `WorkspaceSkillRow` offers only a switch (`active dir` / `disabled dir`) |
| `completions.test.ts` | `--project` / `--project-root` / `--all` / `--files` offered by all four templates; the `--project-root` value is skipped when counting positionals |

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

### Viewer and switch extras

The script pre-dates the project viewer. To see it, write a root `$PROJ/SKILL.md`
with a valid `name`/`description` and rerun `list --project`: the
`Folder skills` section shows the parsed name and description, not just the
filename. To exercise the switch, link a source and run
`disable --project <name> --json`; assert `.dsh/skills-disabled/<name>` exists
and the target's `SKILL.md` is untouched, then `enable --project <name>`
restores the active link.

### Real-directory toggle (`--files`)

`--files` is the second toggle channel: it moves a **real** directory between
the two project roots and refuses links (which belong to the link channel). With
the walkthrough's project still in place:

```bash
(
  set -e
  PROJECT="$(pwd)"
  BASE="${TMPDIR:-/tmp}/nexus-files-verify-$$"
  if command -v cygpath >/dev/null 2>&1; then BASE="$(cygpath -m "$BASE")"; fi
  export DSH_HOME="$BASE/home"
  PROJ="$BASE/proj"
  nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }
  expect_fail() { if "$@" >/dev/null 2>&1; then echo "FAIL: expected a non-zero exit: $*"; exit 1; fi; }

  mkdir -p "$PROJ/.git" "$PROJ/.dsh/skills/real-skill"
  printf -- '---\nname: real-skill\ndescription: demo\n---\n' > "$PROJ/.dsh/skills/real-skill/SKILL.md"

  # F1) disable --files parks the real directory
  nexus disable --project --files real-skill --project-root "$PROJ"
  test ! -e "$PROJ/.dsh/skills/real-skill"
  test -f "$PROJ/.dsh/skills-disabled/real-skill/SKILL.md"
  echo 'PASS F1 disable --files moves a real directory'

  # F2) enable --files brings it back
  nexus enable --project --files real-skill --project-root "$PROJ"
  test -f "$PROJ/.dsh/skills/real-skill/SKILL.md"
  echo 'PASS F2 enable --files restores it'

  # F3) without --files a real directory is user content: refused, exit 1
  expect_fail nexus disable --project real-skill --project-root "$PROJ"
  test -f "$PROJ/.dsh/skills/real-skill/SKILL.md"
  echo 'PASS F3 link mode still refuses real directories'

  rm -rf "$BASE"
  echo 'cleaned'
)
```

Expected three `PASS` lines then `cleaned`.

## Panel acceptance checklist

Requires a DSH **web** host with the plugin mounted (see [Local testing steps](../README.md#local-testing-steps)). Static rendering is covered by the test suite; the checklist below is the UI integration gate.

1. Open **Settings → Skills Nexus**. The section has two tabs: **Global skills** (the default) and **Project skills**.
2. Switch to **Project skills**. With the folder field empty, the tab says `enter a project folder to see its skills`, and **no request** is sent.
3. Enter the temporary project's absolute path (for example `D:\theme-port-skill`) and press **refresh**. The **skills in this folder** section shows the parsed frontmatter name and description, not just `SKILL.md`; the **project skills root** section lists `.dsh/skills` entries (or says it is empty).
4. Press **link** on a folder-skill row. The job runs, the folder row gains a `linked` badge, and a matching link row appears under the project skills root with its parsed name and absolute target.
5. Toggle the link's **Switch** off: the row becomes `disabled`, the link moves to `.dsh/skills-disabled`, and the target directory still exists. Toggle it on again and the link returns.
6. Remove the target directory, press **refresh** again: the row turns into a `dangling` badge (warning tone).
7. A real directory you placed in `.dsh/skills` shows a `user files` badge, **no Switch** and **no remove button**.
8. Press **remove** on a link row: the confirmation overlay says only the link is deleted; after confirming, the row disappears and the target directory still exists.
9. Change the project folder: the old lists are cleared immediately (no stale rows from the previous folder).
10. In the **registered workspace (.dsh)** block above the folder field, click **load workspaces**. On a web host the select lists the registry's workspaces by title; the scan then runs against that workspace's registered path — a path that is not in the registry cannot be selected here (type it into the folder field instead).
11. Pick a workspace whose `.dsh/skills` holds a real directory. Rows show `active dir` and a **Switch**; there is no remove button — the workspace channel never deletes user content.
12. Toggle that switch off: the row becomes `disabled dir` and the directory appears under that workspace's `.dsh/skills-disabled`; toggle it back and the directory returns. Links are not movable here — the row only exists for real entries.
13. Pick a workspace with no `.dsh` at all: the block says `no real directories under the project skills root.` That is an empty result, not an error.
14. On a headless host (no `@deepseek-ai/dsh-web-app`), **load workspaces** answers `available: false` with an explanatory hint, the manual folder field keeps working, and nothing silently falls back to an unregistered path.

## HTTP surface

The manual project folder talks to four routes; they are internal plumbing, not the stable machine interface (that is the CLI `--json` reports).

| Route | Body / query | Answer |
|---|---|---|
| `GET /skills-nexus/project/list` | `?root=<absolute path>` | `{ projectRoot, folderSkills, entries }` |
| `POST /skills-nexus/project/link` | `{ root, dir }` | synchronous plan `{ projectRoot, source, results }` |
| `POST /skills-nexus/project/link` | `{ root, dir, confirm: true }` | `202 { data: { jobId } }`; poll `GET /job?id=` |
| `POST /skills-nexus/project/toggle` | `{ root, name, enabled }` | `{ projectRoot, name, enabled, status }` |
| `POST /skills-nexus/project/remove` | `{ root, name, confirm: true }` | `{ projectRoot, name, status: 'removed' }` |

All four require same-origin and a loopback socket. A `root` that is not an existing directory answers `400 invalid-root`; a name with a path separator answers `400 invalid-name`; a real directory or file answers `409 not-a-link` (or `409 collision` when the other location is occupied); a missing route input answers `400 missing-field`; a UNC source on Windows answers `400 unsupported-source`.

The registered-workspace block talks to three more routes. They are privileged by
construction: the target must be a path the host registry already knows.

| Route | Body / query | Answer |
|---|---|---|
| `GET /skills-nexus/workspaces/list` | — | `{ data: { available, items: [{ id, path, title, projectRoot, exists }] } }` |
| `GET /skills-nexus/workspace/skills` | `?workspace=<registered path>` | `{ data: { workspace, entries } }` |
| `POST /skills-nexus/workspace/toggle` | `{ workspace, name, enabled }` | `{ data: { workspace, name, enabled, status } }` |

When the host has no workspace registry, the list answers `available: false` with
an empty `items`, and the other two routes answer `503 workspace-unavailable`;
there is deliberately no fallback to an arbitrary path. A non-absolute query
answers `400 invalid-workspace`, a path no registry row names answers
`400 workspace-unregistered`, and a root whose `.dsh` / `.dsh/skills` /
`.dsh/skills-disabled` level is a symlink or junction answers `409 unsafe-root`.
A registry that throws on `list()` answers `500 registry-error`.

The toggle moves **real directories only**: a link there still answers HTTP 200,
but with `status: 'not-files'` instead of `'enabled'` / `'disabled'` — links
belong to `/project/toggle`, and the client surfaces that verdict as the row's
error instead of pretending the move happened.

## Known boundaries

- **No state.** There is no `projectRoot` in the manifest, no migration and no "stale project" failure class. The folder is the record.
- **Links are machine-local.** They store an absolute path; committing `.dsh/skills/` or `.dsh/skills-disabled/` links is meaningless for teammates (and Git on Windows may walk a junction as a directory). Add both to `.gitignore` for the link-only workflow; vendored real directories are the shareable form.
- **Names.** DSH's catalog name comes from the `SKILL.md` frontmatter; the link **entry name** is a filesystem key derived from the directory (frontmatter fallback for a non-ASCII directory). The panel and CLI show the parsed name, so a flat `SKILL.md` row is not anonymous.
- **Disable is a link move.** The link goes to the sibling `.dsh/skills-disabled/`; the target and dangling state survive, and disabling un-shadows a global skill of the same name. No `SKILL.md` is edited.
- **Exact-name removal.** `remove --project` accepts names, not globs or group prefixes; the refusal is deliberate, to keep the destructive surface one link wide.
- **`list --all` is human-only.** It joins two datasets (filesystem links and manifest entries) and is not part of the version-1 JSON contract; use `list --json` and `list --project --json` for machines.
- **Windows junction targets.** A junction needs a local absolute path; UNC shares are refused up front instead of surfacing a raw `EPERM`.
- **The panel has two doors.** The manual folder field is typed and per-session (this client context injects only `slots`, so there is no root to read), while the registered-workspace block reads the host registry and is therefore only populated on the DSH web profile. Neither persists anything.

For the full command and option surface, see [Project skills](../README.md#project-skills) in the README.

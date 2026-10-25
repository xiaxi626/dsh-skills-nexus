# Sources and packages

> [中文](sources-and-packages.zh-CN.md) | **English**

How skills enter the nexus and how they are packaged for transport.

## Source channels

Skills enter the nexus through five channels. Each produces an entry in
`manifest.json`; the entry's updatability depends on whether it carries a
git source.

| Channel | Command | Identity source | Updatable | Typical use |
|---|---|---|---|---|
| A | `add <spec>` | `url + ref + commit` from the clone | Yes | Public or private git repos |
| B | `import <dir>` | Probed from `.git` remote or metadata; empty if none | Probed → yes; otherwise frozen | Skills already on disk, legacy directories |
| C | `export` / `import <pkg>` | `nexus-package.json` label inside the package | Reachable source → yes; `--locked` restores the exact commit; otherwise frozen | Cross-machine migration, reproducible restore, offline delivery |
| D | `adopt <name> --url` | User provides it explicitly | Yes, after the operation completes | A frozen entry whose repository was found later |
| E | `link <source>` | Local directory path (no git) | No (external entries) | Reference skills from directories you already own |

## Channel A: git source (`add`)

```bash
dsh-skills-nexus add github:owner/repo
dsh-skills-nexus add github:owner/repo --ref v1.0 --subdir skills/foo --name my-skill
dsh-skills-nexus add https://gitlab.com/group/project   # any git host
```

`add` clones the repository, discovers skills via the same rules the official
DSH filesystem provider uses, normalizes frontmatter, creates symlinks in
`~/.dsh/skills/`, and records the entry with `url`, `gitUrl`, `ref`, and
`commit`. The entry is updatable from the start.

| Flag | Effect |
|---|---|
| `--ref <branch/tag/commit>` | Pin a version (default: remote's default branch) |
| `--subdir <path>` | Install one subdirectory of a collection repo |
| `--name <name>` | Override the entry name (default: repo slug or subdir leaf) |
| `--yes` | Skip confirmation prompts |

Multiple specs install independently: `add A B` clones two repos. Per-repo
flags (`--name`, `--ref`, `--subdir`) apply to a single repo and are rejected
with multiple specs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full clone → normalize → link
flow and the filesystem layout.

## Channel C: packages (`export` / `import`)

A package is a **transport container**, not a second install format. It carries
the skill files *and* a `nexus-package.json` label recording where each entry
came from (`url` / `gitUrl` / `ref` / `commit` / `subdir`), whether it was
enabled, and which links it owned. The importer prefers to re-fetch from the
recorded source; the files are the fallback.

### Export

```bash
dsh-skills-nexus export <name>... -o <file>
dsh-skills-nexus export --all                          # every managed entry
```

Produces a package (`.zip` archive or directory tree, chosen by the output
file extension). The package structure:

```
nexus-package.json          # label with source metadata
skills/<name>/...           # complete file tree per skill
```

The export contains the entry's skill root verbatim (the part after `subdir`,
when present). **A package never contains `.git` directories or credentials.**

| Flag | Effect |
|---|---|
| `<name>...` | Export specific entries by name |
| `--all` | Export every managed entry (including disabled ones) |
| `-o <file>` | Output path (default: `<name>.zip` for single, `nexus-export-<YYYYMMDD>.zip` for `--all`) |

Entries marked `ownership: 'external'` are always skipped — they point at a
directory the user owns, and nexus neither reads nor copies it. Skipped
entries are recorded in the label's `skipped[]` array.

### Import

```bash
dsh-skills-nexus import <file|dir>
dsh-skills-nexus import <file> --dry-run                 # preview only
dsh-skills-nexus import <file> --locked                  # restore exact recorded commits
dsh-skills-nexus import <file> --no-remote               # force snapshot
```

Accepts a package (zip or directory) and rebuilds entries from it.

| Flag | Effect |
|---|---|
| `--dry-run` | Preview what would happen without touching nexus state |
| `--locked` | Restore labelled entries at their exact recorded commits; requires safe non-empty `gitUrl`/`ref` and a full 40–64 digit SHA |
| `--no-net-check` | Skip remote reachability checks (zero wait, offline-safe) |
| `--no-remote` | Force snapshot even when the label records a reachable url |
| `--name <name>` | Override the entry name (single-entry packages) |
| `--subdir <path>` | Import only one candidate root from the package |
| `--each` | One entry per candidate root (N entries = N independent copies) |
| `--force` | Replace an already-registered entry of the same name |

**Candidate root scan (peel).** Third-party packages have unpredictable
layouts — a common pattern is `skills/<name>/SKILL.md` with an extra wrapping
directory. Import scans for candidate roots by peeling wrapper directories,
one layer at a time, reusing the same three discovery rules `add` uses:

```
root = extraction root; peel = 0
loop:
  skills = locateSkillFiles(root)
  if skills found: candidate root = root; break
  if root has exactly 1 subdirectory and peel < 3: root = that subdir; peel++; continue
  break → no candidates
```

| Package layout | Peel count | Result |
|---|---|---|
| `SKILL.md` | 0 | Candidate root = extraction root |
| `alpha/SKILL.md` (+ `beta/SKILL.md`) | 0 | Candidate root = extraction root, 2 skills |
| `skills/alpha/SKILL.md` | 1 | Candidate root = `skills/`, skill = `alpha` |
| `export-2026/skills/alpha/SKILL.md` | 2 | Candidate root = `export-2026/skills/` |

Peel limit: 3 layers (deepest hit at depth 4). Beyond that, if `SKILL.md`
exists deeper, the error is `skill-nested-too-deep` (with the actual depth
and location, plus a `--subdir` hint).

**Per-entry decision.** For each candidate root, the importer checks whether
the label's recorded url is reachable:

| Condition | Outcome |
|---|---|
| `--locked` + complete labelled source metadata | Skip the reachability probe; shallow-fetch and detach at the recorded commit, with `locked: true` in the installed manifest |
| Label has url, url is reachable | Re-clone from git — updatable entry |
| Label has url, url is unreachable | Snapshot (frozen), with `(url unreachable)` note |
| Label has url, check times out (5s default) | Snapshot, with `(url check timed out)` note |
| No label (bare package) | Snapshot, with `(source unknown)` note |

`--locked` is mutually exclusive with `--no-net-check` and `--no-remote`, and
bare packages cannot use it. An exact restore falls back to the packaged
snapshot only when the remote explicitly reports the recorded commit as
unavailable; network, authentication, local-object, and ambiguous Git failures
remain errors. `--no-net-check` skips reachability entirely; all normal-import
entries show `(not checked)` instead of `unreachable`.

**State restoration.** The label records `enabled` and link names from the
exporting machine. Import restores them as-is — a disabled skill on the
source machine stays disabled on the destination.

**Scope selection** (symmetric with git's `--subdir`):

| Form | Meaning | Entry count |
|---|---|---|
| Default | Whole package as one entry | 1 |
| `--subdir <path>` | One candidate root only | 1 |
| `--each` | One entry per candidate root | N (N independent copies) |

**Manifest-only packages.** If the package contains only a label with no
skill content, import creates no entries or links — it reports "this package
contains no skill content" and lists each label entry as a suggested action
(add / adopt / snapshot). The user decides whether to act.

### `--dry-run` output contract

`import --dry-run` prints (and supports `--json` for machine consumption):

```
package: claude-skills.zip (zip) · manifest: none (source unknown)
  skills/alpha      name=alpha-skill   will import as snapshot (source unknown)
  skills/beta       name=beta-skill    will import as snapshot (source unknown)
```

Normal import asks whether the package carries a label and whether the recorded
url is reachable. `--locked` instead validates the label and plans the exact
recorded commit without probing the remote:

| Condition | Output |
|---|---|
| `--locked` + valid labelled entry | `will clone locked commit <commit> from <url> (source ref: <ref>; snapshot fallback only if that commit is unavailable)` |
| Label + url reachable | `will clone from <url> (<ref>)` |
| Label + url unreachable | `will import as snapshot (<url> unreachable)` |
| Label + check timed out | `will import as snapshot (<url> check timed out)` |
| No label (bare package) | `will import as snapshot (source unknown)` |

## Channel D: attach source (`adopt`)

```bash
dsh-skills-nexus adopt <name> --url <git-url> [--ref <r>] [--subdir <p>] [--force] [--prune]
```

Gives a frozen entry (no git source) an identity, turning it into an ordinary
updatable entry indistinguishable from one `add` created. The entry keeps its
name and `path`; only the clone is replaced.

Prerequisite: the entry currently has no git source. Use `--force` to
re-source an entry that already has one.

| Flag | Effect |
|---|---|
| `--url <repo>` | **Required.** The repository to clone from — adopt never guesses |
| `--ref <ref>` | Branch, tag, or commit (default: remote's default branch) |
| `--subdir <path>` | Repo-relative skill root |
| `--force` | Re-source an entry that already has a git source |
| `--prune` | Delete the pre-adopt backup on success |

**Seven-step sequence** (isomorphic with `switch-version`):

1. Parse `url/ref`, clone into a staging directory `repos/.adopt-stage-*`
2. Discover skills with the same rules as install; compare with the entry's
   current skill set — mismatch refused by default (`--force` overrides)
3. Back up the current directory: `repos/<path>` → `repos/<path>.pre-adopt-<ts>`
4. Move the staging directory into place as `repos/<path>`
5. Rebuild links: delete old set, create new set from discovered skills
6. Update manifest: write `url/gitUrl/ref/commit/subdir`, refresh `updatedAt`
7. With `--prune`, delete the backup; otherwise report the backup path

**Failure rollback.** If any step fails: restore the backup directory,
restore the old link set, manifest is unchanged, non-zero exit with the
reason. The rollback is best-effort (swallows its own errors, same pattern
as `rollbackSwitch`).

**Boundaries.** Does not change the entry name. Does not change link names
(except those needed for rebuild). **Never guesses the url** — the caller
must provide it explicitly.

## Channel E: external reference (`link`)

```bash
dsh-skills-nexus link trae-cn                       # discover skills under ~/.trae-cn/skills/
dsh-skills-nexus link trae                          # discover skills under ~/.trae/skills/
dsh-skills-nexus link qoder                         # user-level skills + marketplace plugins under ~/.qoder
dsh-skills-nexus link qoder-cn                      # same layout for Qoder CN, under ~/.qoder-cn
dsh-skills-nexus link codebuddy                     # discover skills under ~/.codebuddy/skills/
dsh-skills-nexus link workbuddy                     # discover skills under ~/.workbuddy/skills/
dsh-skills-nexus link trae --source-dir /path        # override the source root, not skills/
dsh-skills-nexus remove --group trae --yes           # unlink; keep the external directories
dsh-skills-nexus remove --group qoder --yes          # same for every qoder entry
dsh-skills-nexus link trae-cn --dry-run             # preview without creating entries
dsh-skills-nexus link trae-cn --group custom        # override the L1 group name
dsh-skills-nexus link trae-cn --force               # replace existing entries on conflict
```

`link` discovers skills from external directories the user already owns and
creates *external entries* — manifest records with `ownership: 'external'`
that symlink to those directories. Nexus never clones, updates, or deletes
the target directories. `remove` only deletes the link and the manifest
entry, never the directory.

Supported sources:

| Source | Default root | Environment override | What is discovered |
|---|---|---|---|
| `trae-cn` | `~/.trae-cn` | `TRAE_CN_DIR` | one level under `<root>/skills/` |
| `trae` | `~/.trae` | `TRAE_DIR` | one level under `<root>/skills/` |
| `qoder` | `~/.qoder` | `QODER_DIR` | one level under `<root>/skills/`, plus the skill directories each marketplace plugin declares |
| `qoder-cn` | `~/.qoder-cn` | `QODER_CN_DIR` | same as `qoder`: user-level `<root>/skills/` plus each marketplace plugin's declared skill directories |
| `codebuddy` | `~/.codebuddy` | `CODEBUDDY_DIR` | one level under `<root>/skills/` |
| `workbuddy` | `~/.workbuddy` | `WORKBUDDY_DIR` | one level under `<root>/skills/` |

Precedence: `--source-dir` > `--trae-cn-dir` (legacy alias) > the selected
source's environment variable > configured defaults. Overrides select a
single root — for `qoder` / `qoder-cn` that is the agent root (`~/.qoder` /
`~/.qoder-cn`), never its `skills/` child; a nonexistent override is an error,
not a request to fall back. The generic registry supports ordered
`rootCandidates`: all existing roots are scanned, absolute directories are
deduplicated, and the first occurrence of each management name wins across
roots. Current sources each have just one default root. Built-in skills and
nested layouts stay outside discovery. CodeBuddy and WorkBuddy scan the same
fixed subdirectory, so 0 skills usually means `<root>/skills/` is missing or
laid out differently: a missing root is `not-found`, while a present root
without that subdirectory only yields an empty plan.

| Flag | Effect |
|---|---|
| `--source-dir <path>` | Override the selected source root (space or `--source-dir=<path>` form) |
| `--trae-cn-dir <path>` | Backward-compatible alias; `--source-dir` wins if both are given |
| `--group <name>` | Override the L1 group name (default: the source value) |
| `--dry-run` | Preview the plan without creating entries or symlinks |
| `--force` | Replace existing manifest entries on name conflict |
| `--json` | Emit a machine-readable report |

### How the Qoder sources are scanned

A Qoder root holds two different layouts, so `qoder` and `qoder-cn` share one
discovery function (`src/qoder.ts`) instead of the fixed-subdirectory scanner.
Both clients use the same layout — only the root differs (`~/.qoder` vs.
`~/.qoder-cn`):

1. **User-level skills** — one level under `<root>/skills/`; segment `skills`.
2. **Marketplace plugins** — the plugin inventory is read, never written:
   `<root>/plugins/installed_plugins_v2.json`. For each record that is enabled
   and still on disk, the declared skill directories come from
   `<installPath>/.qoder-plugin/plugin.json`, then `<installPath>/plugin.json`,
   then the `./skills/` convention. `skills` may be a string or an array and is
   resolved against `installPath`. A declared directory that carries its own
   `SKILL.md` counts as one skill; otherwise the directory is read one level
   deep.
3. The plugin name — the inventory key before the last `@` (`superpowers` in
   `superpowers@qoder-marketplace`) — becomes the middle `groupPath` segment.

When two discovered skills share a name, the user-level one wins; between
plugins, the first in inventory order wins. A missing inventory, a missing
`installPath`, an install directory that no longer exists and `enabled: false`
are all skipped silently.

### Why the built-in plugins are excluded

`qoder-bundler` publishes the plugins that ship with the Qoder client. Their
`SKILL.md` files assume the plugin root and the Qoder host runtime: they locate
the root with `../..`, read `${QODER_PLUGIN_ROOT}` and call `~/.qodersec/bin`.
Linked on their own they do not work, and their cache contents are rewritten on
every client update. The same publisher is what `~/.qoder-cn` ships: all four
bundled plugins there are `@qoder-bundler` too, so one exclusion rule covers
both roots. This is the rule the Trae sources already follow — only the
user-owned `skills/` is in scope, `builtin_skills/` is not: whatever ships with
the client belongs to the client.

### After a plugin update

`installPath` usually contains a version layer (`…/superpowers/6.3.0`), so an
update moves the directory and leaves the existing symlink dangling. `doctor`
reports such an entry as `missing-target` (links created from external sources
are not part of the orphan scan), but the fix it suggests is `update <name>`,
which does not apply to external entries. Re-run the link instead:

```bash
dsh-skills-nexus link qoder --force
dsh-skills-nexus link qoder-cn --force
```

`--force` replaces the existing entries in place. The flat names stay the same,
so `list`, `enable`/`disable` and `remove` keep working.

### One skill, several sources

`link trae` and `link qoder` both expose the superpowers collection on a machine
that has it installed twice. With both linked, the same `SKILL.md` (same
frontmatter `name`) enters DSH twice under two flat names. Keep one source per
skill collection.

The same skill installed in both Qoder clients is the expected case rather than
a mistake: `qoder` and `qoder-cn` are separate sources, so the two copies become
`qoder.*` and `qoder-cn.*` entries and neither shadows the other. Pick one with
`disable` if you only want a single copy active. `codebuddy` and `workbuddy`
behave the same way: they are independent sources with their own
`<source>.skills.*` namespace, so a skill installed in both stays two entries.

### Naming convention

Each discovered skill becomes an entry with:

- `groupPath = [group ?? source, segment, dirName]` — e.g. `['trae-cn', 'skills', 'brainstorming']` for a fixed-subdirectory source, `['qoder', 'superpowers', 'brainstorming']` for a plugin skill
- `name = groupPath.join('.')` — e.g. `trae-cn.skills.brainstorming`, `qoder.superpowers.brainstorming`, `workbuddy.skills.demo`
- `externalDir` — absolute path to the skill directory
- `ownership: 'external'`

### Group toggle

External entries carry a hierarchical `groupPath`. The `enable` and `disable`
commands accept `--group <path>` to batch-toggle every entry whose
`groupPath` starts with the given prefix:

```bash
dsh-skills-nexus enable --group trae-cn/skills     # enable all trae-cn skills
dsh-skills-nexus disable --group trae-cn            # disable everything under trae-cn
dsh-skills-nexus disable --group qoder/superpowers  # one plugin, not the whole source
dsh-skills-nexus disable --group qoder-cn           # the CN client, leave qoder alone
```

`remove` takes the same prefix to batch-delete a group. The prefix is
`/`-separated and matched segment by segment (the rule `enable`/`disable` use),
it is mutually exclusive with name patterns, and a prefix matching several
entries is confirmed first (or skipped with `--yes`). A prefix that matches
nothing is an error, not an empty success.

```bash
dsh-skills-nexus remove --group trae-cn/skills     # delete every trae-cn skill
dsh-skills-nexus remove --group trae-cn --yes      # ...without the confirmation prompt
dsh-skills-nexus remove --group codebuddy --yes    # the same for the CodeBuddy entries
dsh-skills-nexus remove --group workbuddy --yes    # ...and for WorkBuddy
```

Use `trae` instead of `trae-cn` in group commands for the international
source; use your custom L1 group if you supplied `--group` when linking.
For the Qoder sources the second segment is the plugin name, so `--group qoder`
(or `--group qoder-cn`) covers the whole source and `--group qoder/<plugin>`
one plugin.
The web panel offers Trae CN / Trae / Qoder / Qoder CN / CodeBuddy / WorkBuddy
previews and an optional server-side root, then links the previewed source. It
renders grouped entries under L1 group headers with a group-level Switch
(✓/○/◐ for on/off/mixed).

HTTP `POST /skills-nexus/link` accepts `{ source, sourceDir?, traeCnDir?,
group?, force?, confirm? }`. `sourceDir` takes precedence over the legacy
`traeCnDir`; omit `confirm` (or pass `false`) to preview, and pass `true` to
execute as a job. The client `linkPreview` / `linkLocal` methods forward
`sourceDir` in their options.

### External entries vs managed entries

| | Managed entries | External entries |
|---|---|---|
| Created by | `add`, `import`, `adopt` | `link` |
| `ownership` | `'managed'` | `'external'` |
| Directory owned by | nexus (under `repos/`) | the user |
| Updatable | Yes (git pull) | No (no git source) |
| `remove` deletes directory | Yes | No (only link + manifest) |
| `groupPath` | Not set | Hierarchical path array |

## Package format: `nexus-package.json`

```json
{
  "schema": "dsh-skills-nexus/package",
  "version": 1,
  "exportedAt": "2026-10-02T00:00:00Z",
  "generator": "dsh-skills-nexus 0.4.0",
  "skipped": [
    { "name": "local-notes", "reason": "external (link-only)" }
  ],
  "entries": [
    {
      "name": "daily-trend-writer",
      "url": "github:trae-community/trae-skills",
      "gitUrl": "https://github.com/trae-community/trae-skills.git",
      "ref": "main",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "subdir": "skills/daily-trend-writer",
      "enabled": true,
      "skills": [
        {
          "root": "skills/daily-trend-writer",
          "name": "daily-trend-writer",
          "description": "...",
          "links": ["daily-trend-writer"]
        }
      ]
    }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `schema` / `version` | Yes | Higher `version` → refuse and suggest upgrade; lower → best effort |
| `entries[].name` | Yes | Suggested entry name; `--name` or conflict policy may override |
| `entries[].gitUrl` / `ref` / `subdir` | No | Present → prefer git channel; absent → snapshot |
| `entries[].commit` | No for normal import | Exact revision; `--locked` requires a full 40–64 digit SHA and restores it |
| `entries[].enabled` | No | Enabled state at export time; import **restores** it (default: enabled) |
| `entries[].skills[]` | No | Candidate skills and link names; used by `--dry-run` / panel preview |
| `skipped[]` | No | Entries skipped during export and why; import uses this to prompt manual handling |
| Unknown fields | — | Ignored (forward compatible) |

**Security (export).** A package never contains `.git` (skipped during
walk). Absolute paths, `..`, `:` segments, NUL bytes, and empty names in
entry paths are rejected (zip-slip defense). Symlinks are skipped. URLs
carrying credentials (`https://user:token@host`) are rejected.

**Security (import).** The same restrictions apply during extraction.
External packages must not carry `.git` entries (refused if found). Before
`--locked` invokes Git, it validates the recorded URL and ref with the normal
argument-safety boundary and accepts only a full hexadecimal commit SHA.

## Entry storage forms

Each entry in the manifest takes one of three forms, which determines how
`remove` handles it:

| Form | Directory owner | Updatable | `remove` behavior | Predicate |
|---|---|---|---|---|
| Git clone | nexus (`repos/<path>`) | Yes | Delete link + clone + deregister | `gitUrl` non-empty |
| Snapshot copy | nexus (`repos/<path>`) | No | Same as git clone | `gitUrl` empty |
| External directory | **User's own** | No | **Only delete link and registration, never the directory** | `ownership: 'external'` |

An explicit package lock is still a Git clone, but `update` verifies its recorded
commit instead of advancing the source ref. `list` exposes `LOCK=yes`, and
`doctor --updates` distinguishes this manifest flag from an ordinary detached
tag/commit pin. A successful `switch-version` clears the explicit lock.

The updatability predicate is `hasGitSource(entry)` in `src/manifest.ts`
— true when `gitUrl.length > 0`. External entries have empty `gitUrl`,
`ref`, and `commit`, so `hasGitSource` is always false for them, and
`update` / `switch-version` always refuse with `400 not-a-git-clone`.

## Invariants

- **Updatable if and only if git source exists.** An entry records `gitUrl`
  (and `ref` non-empty) → `update` / `switch-version` work. No git source →
  refused with `400 not-a-git-clone`.
- **`path` is unique.** Two entries cannot share the same clone directory.
- **Import never overwrites an existing entry name** unless `--force` is given.
- **`remove` never deletes a directory nexus does not own.** External entries
  only lose their link and registration.
- **`adopt` failure is atomic.** Directory, links, and manifest are restored
  to exactly what they were before the operation.
- **Packages never carry `.git` or credentials.** A package is an envelope,
  not a repository.

## Error codes

All errors follow the established dialect (`status + { error, data? }`):

| Scenario | CLI | HTTP |
|---|---|---|
| `update` / `switch-version` on a no-git-source entry | Clear message + exit 1 | `400 not-a-git-clone` |
| No `SKILL.md` in the package | `no-skill-found` + exit 1 | `400 no-skill-found` |
| Skills found but nested too deep | `skill-nested-too-deep` (with location, depth, `--subdir` hint) | `400 skill-nested-too-deep` |
| Package has no `nexus-package.json` | "source unknown (will land as snapshot)", **not an error** | Same (still 2xx) |
| Name collision | Refused; `--force` overrides | `409 already-registered` |

## Panel mirror

The Settings panel mirrors the command surface:

| Command | Panel location | Notes |
|---|---|---|
| `import` | "import package" row: file picker → `--dry-run` preview (four states + candidate roots) → confirm | Preview shows "updatable vs snapshot" distinction |
| `adopt` | Per-entry "attach source" action (url + optional subdir) | Only appears on entries without a git source |
| `export` | "export all" button | Writes a zip under `~/.dsh/skills-nexus/exports/`; the panel shows the path as a copyable notice — no download button |

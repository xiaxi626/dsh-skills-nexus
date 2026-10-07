# Sources and packages

> [中文](sources-and-packages.zh-CN.md) | **English**

How skills enter the nexus and how they are packaged for transport.

## Source channels

Skills enter the nexus through four channels. Each produces an entry in
`manifest.json`; the entry's updatability depends on whether it carries a
git source.

| Channel | Command | Identity source | Updatable | Typical use |
|---|---|---|---|---|
| A | `add <spec>` | `url + ref + commit` from the clone | Yes | Public or private git repos |
| B | `import <dir>` | Probed from `.git` remote or metadata; empty if none | Probed → yes; otherwise frozen | Skills already on disk, legacy directories |
| C | `export` / `import <pkg>` | `nexus-package.json` label inside the package | Reachable source → yes; `--locked` restores the exact commit; otherwise frozen | Cross-machine migration, reproducible restore, offline delivery |
| D | `adopt <name> --url` | User provides it explicitly | Yes, after the operation completes | A frozen entry whose repository was found later |

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

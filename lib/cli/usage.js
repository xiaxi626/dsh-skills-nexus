/**
 * The CLI's `--help` text, kept out of the dispatcher (`index.ts`) for one
 * concrete reason: `index.ts` is an executable module — importing it runs
 * `main(process.argv.slice(2))` — so nothing in it can be imported by a test.
 *
 * The help text is measured by a test: `test/completions.test.ts` asserts that
 * every flag this text documents is offered by all four shell completion
 * templates, which is the guard that keeps `completions --shell <name>` from
 * advertising a flag the CLI does not accept (or missing one it does).
 *
 * A1 moved the write itself from `process.stdout.write` to `io.emit` — the last
 * CLI output that bypassed the `OpsIO` seam. That refactor is exactly what a
 * source-scraping guard turns into a false failure: the old test reached into
 * `printHelp`'s `write(\`…\`)` call with a regexp, so it broke on a change that
 * produced byte-identical output. Hoisting the text into a named export and the
 * printer into a callable that takes an `OpsIO` makes the guard depend on the
 * text, not on how the text is printed.
 */
import { SUPPORTED_SOURCES } from '../external.js';
import { cliIO } from '../ops-io.js';
/**
 * Every word `main()` routes, aliases included — the list the four shell
 * completion templates have to offer, in the sorted order they emit.
 *
 * It lives here rather than being scraped out of `index.ts` at test time
 * because `index.ts` is an executable module and a compiled test run has no
 * `.ts` source to read. `test/completions.test.ts` still cross-checks this
 * constant against the dispatcher's own `case` labels whenever the sources are
 * reachable, so a new subcommand cannot be added to the router and forgotten
 * here; and the help text above is asserted to document every one of them.
 */
export const ROUTED_SUBCOMMANDS = [
    'add',
    'adopt',
    'completions',
    'disable',
    'diff',
    'doctor',
    'enable',
    'export',
    'help',
    'import',
    'link',
    'list',
    'ls',
    'pull',
    'purge',
    'remove',
    'rm',
    'rollback',
    'switch-version',
    'update',
];
/** The full help text, as one pure constant. */
export const HELP_TEXT = `dsh-skills-nexus — register any git SKILL.md repo as a DSH skill
Usage:
  dsh-skills-nexus add    <repo-spec>...              [--name <name>] [--subdir <path>] [--yes] [--json]
  dsh-skills-nexus list [--names | --json] [--filter <query>]
  dsh-skills-nexus update [name] [--json]   # refresh clones (default: all enabled)
  dsh-skills-nexus rollback <name> [--json] # 恢复最近一次成功的版本变更
  dsh-skills-nexus diff <name> [<ref>] [--stat]
                                            # preview remote changes without checkout
  dsh-skills-nexus export <name>... | --all [--out <file>]
                                            # package skills for another machine
  dsh-skills-nexus import <package> [--dry-run] [--locked] [--force]
                                            # rebuild entries from a package
  dsh-skills-nexus adopt  <name> --url <repo> [--ref <ref>] [--subdir <path>] [--force] [--prune]
                                            # give a source-less entry a git source
  dsh-skills-nexus switch-version <name> <ref> [--type <branch|tag|commit>]
                                            # move a clone to another version
  dsh-skills-nexus link   <source> [--dry-run] [--group <name>] [--force] [--json]
                                            # register external skills (${SUPPORTED_SOURCES.join(', ')})
  dsh-skills-nexus remove <name-or-pattern>... [--group <path>] [--yes] [--json]
  dsh-skills-nexus enable  <name>... [--group <path>] [--json]
  dsh-skills-nexus disable <name>... [--group <path>] [--json]
  dsh-skills-nexus doctor [--json] [--updates] [--quiet]  # read-only full checkup
  dsh-skills-nexus purge  [--yes] [--json]                # clean up accumulated artifacts
  dsh-skills-nexus completions --shell <bash|zsh|fish|powershell>  # print a completion script

Options:
  --name <name>     entry name (default: repo slug, or subdir's last segment; when the
                    explicit name only repeats the default, a hint says it can be omitted)
  --ref <ref>       branch / tag / commit (same as the #ref suffix)
  --subdir <path>   install one subdirectory of a collection repo, e.g. --subdir skills/foo.
                    Uses a partial clone + sparse checkout when Git and the remote support
                    it, so unrelated directories are normally not materialized; the output
                    always reports the mode used and warns when the clone was complete.
  --yes             skip confirmation prompts (large collections; multi-match removal)
  --json            emit a stable machine-readable report (version 1) on stdout.
                    Supported by add, list, update, rollback, remove, enable, disable and purge; stdout
                    then carries the JSON document alone and every diagnostic goes to
                    stderr. Prompts cannot be answered in this mode, so pass --yes for
                    the operations that would otherwise ask. Exit codes: 0 ok, 1 error
                    or partial failure, 2 usage error.

  list options:
  --names           print only skill names, one per line (machine-readable; used by
                    shell completion). Cannot be combined with --json.
  --filter <query>  narrow output to entries whose name, URL or subdir contain the
                    query (case-insensitive substring match). Applies to the default
                    table, --names and --json alike.

  doctor options:
  --json            emit a stable machine-readable report (version 1) on stdout
  --updates         also compare branch-pinned entries against their remote (network)
  --quiet           print nothing unless there is at least one error (CI convenience)

  purge options:
  --yes             actually delete the artifacts; without this flag the command
                    is a dry-run that lists what would be removed
  --json            emit a stable machine-readable report (version 1) on stdout

  export options:
  --all             package every entry in the manifest, disabled ones included
                    (cannot be combined with entry names)
  --out <file>      output path (alias: -o). A name ending in .zip is written as
                    an archive, anything else as a directory tree. Default:
                    <name>.zip, nexus-export.zip for several names, and
                    nexus-export-<YYYYMMDD>.zip for --all

  import options:
  <package>         a .zip archive or a directory produced by export — or by
                    anyone else. Entries whose recorded remote answers are
                    rebuilt as real clones (updatable); the rest land as
                    snapshots and can be adopted later.
  --dry-run         report what would happen and touch nothing
  --locked          restore labelled entries at their exact recorded commits;
                    falls back to payload only when that commit is unavailable
  --subdir <path>   import one root only: a package-relative directory for a
                    bare package, an entry name for a labelled one
  --each            one entry per skill instead of one entry per package root
  --force           replace an entry that is already registered (remove + add)
  --no-remote       land everything as a snapshot, even with a recorded remote
  --no-net-check    skip the remote probe entirely (offline: no waiting)

  adopt options:
  <name>            the entry to adopt: one that has no git source yet, or any
                    entry together with --force (that reads as "re-source it")
  --url <repo>      where the entry really comes from (required — adopt never
                    guesses a URL). Accepts the same forms as add.
  --ref <ref>       branch / tag / commit of the new source (default: the
                    remote's default branch)
  --subdir <path>   repo-relative skill root inside the new clone (default: the
                    entry's recorded subdir, or the clone root when it has none)
  --force           adopt a source that yields different skills than the entry
                    exposes today, and re-source an entry that already has one
  --prune           delete the backup of the previous directory after a
                    successful adopt; without it the backup path is printed

  completions options:
  --shell <name>    target shell: bash, zsh, fish or powershell

  rollback:
    仅支持单 entry，恢复最近一次 branch update 或 switch-version，不提供 redo。
    当前 HEAD、manifest 和链接必须匹配恢复记录；dirty worktree 警告后丢弃。
    成功后恢复点已消费；如需再次前进请使用 update/switch-version。

  diff options:
  --stat            show a diffstat instead of the unified patch
    Only an attached, explicitly unlocked branch may omit <ref>; tags, commits,
    detached HEADs and explicitly locked entries must name a target. The remote
    comparison uses a depth-1 fetch and never checks out or rewrites manifest or
    links. A partial clone keeps blob:none; the first comparison may fetch blobs
    lazily, so a large diff can take longer.

  switch-version options:
  --type <t>        hint how <ref> should be treated: branch, tag or commit. The
                    fetched ref decides the checkout; the hint only orders the
                    offline fallback and is never persisted.

  link options:
  <source>          external source identifier (${SUPPORTED_SOURCES.join(', ')})
  --dry-run         preview what would be linked without creating anything
  --group <name>    set the L1 group name (default: the source value)
  --source-dir <d> override the selected source root (not its skills/ subdirectory)
                    defaults: trae-cn ~/.trae-cn; trae ~/.trae; qoder ~/.qoder
                    (user-level skills + marketplace plugins); qoder-cn ~/.qoder-cn
                    (same layout); codebuddy ~/.codebuddy; workbuddy ~/.workbuddy;
                    copilot ~/.copilot; claude-code ~/.claude; pi ~/.pi/agent;
                    codex ~/.codex; cursor ~/.cursor; shared ~/.agents;
                    opencode ~/.config/opencode; gemini ~/.gemini; zcode ~/.zcode;
                    openclaw ~/.openclaw; augment ~/.augment; kimi-code ~/.kimi-code;
                    windsurf ~/.codeium/windsurf
                    precedence: --source-dir > alias > TRAE_CN_DIR / TRAE_DIR /
                    QODER_DIR / QODER_CN_DIR / CODEBUDDY_DIR / WORKBUDDY_DIR /
                    COPILOT_HOME / CLAUDE_CONFIG_DIR / PI_CODING_AGENT_DIR / CODEX_HOME /
                    CURSOR_DIR / SHARED_DIR / OPENCODE_CONFIG_DIR / GEMINI_DIR /
                    ZCODE_DIR / OPENCLAW_STATE_DIR / AUGMENT_DIR / KIMI_CODE_DIR /
                    WINDSURF_DIR > default
                    KIMI_CODE_HOME (Kimi) and GEMINI_CLI_HOME (Gemini) relocate the
                    client's own data root/home, not this root: pass --source-dir or
                    the *_DIR variable above to follow a moved data root.
  --trae-cn-dir <d> backward-compatible alias for --source-dir
  --force           bypass name-collision checks and overwrite existing entries

  enable/disable options:
  --group <path>    toggle every entry whose groupPath starts with this prefix
                    (/-separated, e.g. --group trae-cn/skills). When --group is
                    given, names may be omitted to toggle the whole group

  remove options:
  --group <path>    remove every entry whose groupPath starts with this prefix
                    (/-separated, e.g. --group trae-cn/skills). Mutually exclusive
                    with name patterns; a group matching several entries is
                    confirmed first (or pass --yes)

  Value options also accept --flag=value (e.g. --subdir=skills/foo); --yes takes no value.

Batch:
  add     accepts multiple repo specs: "add A B C" installs each in turn, and a
          failure on one does not abort the rest (exit code is non-zero if any
          failed). --name/--ref/--subdir are per-repo, so they cannot be combined
          with multiple specs — run separate "add <repo> <option>" commands to
          customize each, or drop the option to install all with default names.
  remove  accepts multiple names plus * / ? globs matched against skill names,
          e.g. "remove 'theme-*'". A glob matching more than one skill is
          confirmed first (or pass --yes); quote it so your shell does not expand
          it. Each name is removed independently (non-zero exit if any was not
          found).
  enable  accept multiple names, like remove: "enable a b c" toggles each entry
  disable independently, and the exit code is non-zero if any name is unknown.
  export  accepts multiple entry names and writes ONE package containing all of
          them, or --all for the whole manifest. Packages carry the skills plus a
          nexus-package.json label recording where each entry came from, so the
          receiving machine can rebuild them as updatable entries instead of
          frozen copies. Nothing is registered or linked by exporting.

Accepted repo forms:
  github:owner/repo                      (GitHub shorthand)
  github:owner/repo#branch
  https://github.com/owner/repo
  https://gitlab.com/group/project       (any git host)
  https://gitee.com/owner/repo
  git+https://github.com/owner/repo.git
  git@github.com:owner/repo.git          (SSH)
  ssh://git@github.com/owner/repo.git   (SSH)
  owner/repo                             (GitHub only — resolves to github.com)

  The bare owner/repo shorthand and the github: prefix are GitHub-specific.
  For other platforms (GitLab, Gitee, Bitbucket, self-hosted), use the full
  https:// or git@ URL.

  An https /tree/<ref>/<path> suffix is accepted but ignored — nexus clones the
  repo root. To install a single subdirectory of a collection repo, pass
  --subdir <path>; the /tree path does not select it. A --subdir entry keeps its
  own clone (sharing nothing with other entries), and only the subdirectory is
  materialized: files directly inside the repository root / ancestor directories
  come along, while a skill that reads files outside its own directory needs
  "git -C <clone> sparse-checkout disable" to fetch the rest.

State is stored at: ~/.dsh/skills-nexus/manifest.json
Repo clones live in: ~/.dsh/skills-nexus/repos/<name>/
Skills exposed via:  ~/.dsh/skills/<name>/          (symlinks, official DSH root)
`;
/**
 * Print the help through the caller's `OpsIO`. The bytes are identical to the
 * former direct `process.stdout.write(HELP_TEXT)`: `HELP_TEXT` already ends in
 * a newline, and `cliIO.emit` appends one only when it is missing.
 */
export function printHelp(io = cliIO) {
    io.emit(HELP_TEXT);
}
//# sourceMappingURL=usage.js.map
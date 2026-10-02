#!/usr/bin/env node
/**
 * dsh-skills-nexus CLI
 *
 *   add    github:owner/repo[#ref]... [--name <name>] [--yes]
 *   list   [--names]
 *   update [name]
 *   export <name>... | --all [--out <file>]
 *   switch-version <name> <ref> [--type <branch|tag|commit>]
 *   remove <name-or-pattern>... [--yes]
 *   enable  <name>
 *   disable <name>
 *   doctor [--json] [--updates]
 *   completions --shell <bash|zsh|fish|powershell>
 *
 * Pure CLI tool — clones GitHub SKILL.md repos and exposes them via symlinks
 * in the official DSH skills root (~/.dsh/skills/). The official filesystem
 * provider handles discovery, watching, and error tolerance automatically.
 */
import { add } from './commands/add.js';
import { list } from './commands/list.js';
import { update } from './commands/update.js';
import { exportCommand } from './commands/export.js';
import { switchVersion } from './commands/switch-version.js';
import { remove } from './commands/remove.js';
import { toggle } from './commands/toggle.js';
import { doctor } from './commands/doctor.js';
import { completions } from './commands/completions.js';
import { cliIO } from '../ops-io.js';
async function main(argv) {
    const [cmd, ...rest] = argv;
    // The CLI half of the OpsIO seam (§4.2): every command receives cliIO
    // explicitly here, so the one place a front end picks its implementation
    // is visible in the dispatcher.
    const io = cliIO;
    switch (cmd) {
        case 'add':
            return add(rest, io);
        case 'list':
        case 'ls':
            return list(rest, io);
        case 'update':
        case 'pull':
            return update(rest, io);
        case 'export':
            return exportCommand(rest, io);
        case 'switch-version':
            return switchVersion(rest, io);
        case 'remove':
        case 'rm':
            return remove(rest, io);
        case 'enable':
            return toggle(rest, true, io);
        case 'disable':
            return toggle(rest, false, io);
        case 'doctor':
            return doctor(rest, io);
        case 'completions':
            return completions(rest, io);
        case '-h':
        case '--help':
        case 'help':
        case undefined:
            printHelp();
            return 0;
        default:
            process.stderr.write(`Unknown command: ${cmd}\n\n`);
            printHelp();
            return 2;
    }
}
// Kept on `process.stdout.write`, not `io.emit`: Phase 2 collects the direct
// write call sites (§4.2), and test/completions.test.ts scrapes this function
// to diff the help text against the completion templates.
function printHelp() {
    process.stdout.write(`dsh-skills-nexus — register any GitHub SKILL.md repo as a DSH skill

Usage:
  dsh-skills-nexus add    <github:owner/repo[#ref]>... [--name <name>] [--subdir <path>] [--yes]
  dsh-skills-nexus list [--names]
  dsh-skills-nexus update [name]            # refresh clones (default: all enabled)
  dsh-skills-nexus export <name>... | --all [--out <file>]
                                            # package skills for another machine
  dsh-skills-nexus switch-version <name> <ref> [--type <branch|tag|commit>]
                                            # move a clone to another version
  dsh-skills-nexus remove <name-or-pattern>... [--yes]
  dsh-skills-nexus enable  <name>
  dsh-skills-nexus disable <name>
  dsh-skills-nexus doctor [--json] [--updates] [--quiet]  # read-only full checkup
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

  list options:
  --names           print only skill names, one per line (machine-readable; used by
                    shell completion)

  doctor options:
  --json            emit a stable machine-readable report (version 1) on stdout
  --updates         also compare branch-pinned entries against their remote (network)
  --quiet           print nothing unless there is at least one error (CI convenience)

  export options:
  --all             package every entry in the manifest, disabled ones included
                    (cannot be combined with entry names)
  --out <file>      output path (alias: -o). A name ending in .zip is written as
                    an archive, anything else as a directory tree. Default:
                    <name>.zip, nexus-export.zip for several names, and
                    nexus-export-<YYYYMMDD>.zip for --all

  completions options:
  --shell <name>    target shell: bash, zsh, fish or powershell

  switch-version options:
  --type <t>        hint how <ref> should be treated: branch, tag or commit. The
                    fetched ref decides the checkout; the hint only orders the
                    offline fallback and is never persisted.

  Value options also accept --flag=value (e.g. --subdir=skills/foo); --yes takes no value.

Batch:
  add     accepts multiple repo specs: "add A B C" installs each in turn, and a
          failure on one does not abort the rest (exit code is non-zero if any
          failed). --name/--ref/--subdir are per-repo, so they cannot be combined
          with multiple specs — run separate "add" commands to customize each.
  remove  accepts multiple names plus * / ? globs matched against skill names,
          e.g. "remove 'theme-*'". A glob matching more than one skill is
          confirmed first (or pass --yes); quote it so your shell does not expand
          it. Each name is removed independently (non-zero exit if any was not
          found).
  export  accepts multiple entry names and writes ONE package containing all of
          them, or --all for the whole manifest. Packages carry the skills plus a
          nexus-package.json label recording where each entry came from, so the
          receiving machine can rebuild them as updatable entries instead of
          frozen copies. Nothing is registered or linked by exporting.

Accepted repo forms:
  github:owner/repo
  github:owner/repo#branch
  https://github.com/owner/repo
  git+https://github.com/owner/repo.git
  git@github.com:owner/repo.git        (SSH)
  ssh://git@github.com/owner/repo.git  (SSH)
  owner/repo

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
`);
}
main(process.argv.slice(2))
    .then((code) => {
    process.exitCode = code;
})
    .catch((err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map
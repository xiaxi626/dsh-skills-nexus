/**
 * fish completion template for `dsh-skills-nexus completions --shell fish`.
 *
 * A plain list of ASCII lines joined on demand — deliberately NOT a template
 * literal, so its `$t[2]` / `(...)` survive being written out. Every line is a
 * double-quoted TS string (the only double quotes in the script are the ones
 * around the expansions below, escaped here); keep the content pure ASCII.
 *
 * fish completions are declarative: each `complete` line carries a condition
 * and its candidates, and fish decides which lines apply to the word being
 * completed. There is no word array to walk in the script body, so the
 * conditions do the inspecting with `commandline -opc` (the tokens of the
 * current command line up to the cursor).
 *
 * Three layers, mirroring the other templates:
 *   1. subcommand      — `__fish_use_subcommand` (nothing but flags typed yet)
 *   2. flags           — one rule per option, scoped to its subcommand
 *   3. installed skill names — the first positional argument of the name-taking
 *      subcommands, obtained by shelling out to `list --names`
 *
 * The names rule counts the non-flag words of the command line: the command
 * name, the subcommand, and nothing else - hence `-eq 2`. Counting rather than
 * looking at a position keeps `remove --yes <TAB>` working, because `--yes` is
 * accepted before the names; none of these commands has a value-taking flag,
 * so a flag value can never be miscounted as a positional. The words are
 * filtered one at a time, each expansion quoted: quoting the whole list makes
 * fish join its elements with spaces into a single argument, so `string match`
 * would see one word and the count could never come out right, and an unquoted
 * empty element expands to nothing - `string match` with no STRING reads
 * stdin, which would hang the completion.
 *
 * Layer 3 goes through the CLI rather than reading `manifest.json`, so an
 * internal schema change cannot silently break completion.
 *
 * The documented install is either `| source` or saving the output as
 * `~/.config/fish/completions/dsh-skills-nexus.fish`, which fish loads on
 * demand. Either way the subcommand and flag lists are duplicated from
 * `src/cli/index.ts`; keep them in sync when a command or flag is added.
 */
export const fishTemplate = [
    '# fish completion for dsh-skills-nexus - enable with:',
    '#   dsh-skills-nexus completions --shell fish | source',
    '# or save the output as ~/.config/fish/completions/dsh-skills-nexus.fish',
    "complete -c dsh-skills-nexus -f -n '__fish_use_subcommand' -a 'add list ls update pull export import adopt switch-version remove rm enable disable doctor help completions'",
    '',
    '# Flags, per subcommand. -r marks the ones that take a value;',
    '# update/pull/enable/disable take only the machine-report flag.',
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l name -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l ref -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l subdir -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l yes",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from list ls' -l names",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from list ls' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from remove rm' -l yes",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from remove rm' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from update pull' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from enable disable' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from export' -l all",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from export' -l out -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l dry-run",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l subdir -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l each",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l force",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l no-remote",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l no-net-check",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l name -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from import' -l yes",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from adopt' -l url -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from adopt' -l ref -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from adopt' -l subdir -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from adopt' -l force",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from adopt' -l prune",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from switch-version' -l type -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from doctor' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from doctor' -l updates",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from doctor' -l quiet",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from completions' -l shell -r -a 'bash zsh fish powershell'",
    '',
    '# Installed skill names - ask the CLI instead of reading its state file,',
    '# so an internal schema change cannot silently break completion.',
    '# export and adopt take names too, but they are the commands with',
    '# value-taking flags (--out, --url), so they are left out here rather than',
    '# making this count flag values.',
    "complete -c dsh-skills-nexus -f -n 'set -l t (commandline -opc); set -l p; for i in (seq (count $t)); if not string match -qr -- ^- \"$t[$i]\"; set -a p \"$t[$i]\"; end; end; contains -- \"$t[2]\" update pull remove rm enable disable; and test (count $p) -eq 2' -a '(dsh-skills-nexus list --names 2>/dev/null)'",
].join("\n") + "\n";
//# sourceMappingURL=fish.js.map
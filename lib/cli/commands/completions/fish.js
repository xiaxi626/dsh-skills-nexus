/**
 * fish completion template for `dsh-skills-nexus completions --shell fish`.
 *
 * A plain list of ASCII lines joined on demand — deliberately NOT a template
 * literal, so its `$t[2]` / `(...)` survive being written out. Every line is a
 * double-quoted TS string (the only double quotes in the script are the two
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
 * so a flag value can never be miscounted as a positional. The expansions are
 * quoted so a user-typed wildcard reaches `string match` literally.
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
    "complete -c dsh-skills-nexus -f -n '__fish_use_subcommand' -a 'add list ls update pull remove rm enable disable doctor help completions'",
    '',
    '# Flags, per subcommand. -r marks the ones that take a value;',
    '# update/pull/enable/disable take none.',
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l name -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l ref -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l subdir -r",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from add' -l yes",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from list ls' -l names",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from remove rm' -l yes",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from doctor' -l json",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from doctor' -l updates",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from doctor' -l quiet",
    "complete -c dsh-skills-nexus -f -n '__fish_seen_subcommand_from completions' -l shell -r -a 'bash zsh fish powershell'",
    '',
    '# Installed skill names - ask the CLI instead of reading its state file,',
    '# so an internal schema change cannot silently break completion.',
    "complete -c dsh-skills-nexus -f -n 'set -l t (commandline -opc); set -l p (string match -r -v -- ^- \"$t\"); contains -- \"$t[2]\" update pull remove rm enable disable; and test (count $p) -eq 2' -a '(dsh-skills-nexus list --names 2>/dev/null)'",
].join("\n") + "\n";
//# sourceMappingURL=fish.js.map
/**
 * zsh completion template for `dsh-skills-nexus completions --shell zsh`.
 *
 * A plain list of ASCII lines joined on demand — deliberately NOT a template
 * literal: the script is full of `${...}` and `$(...)` that would be
 * interpolated. Keep every line a single-quoted TS string (the script uses no
 * apostrophes) and keep the content pure ASCII, so the emitted bytes match on
 * every platform and encoding.
 *
 * Three layers, mirroring what the shell knows at each point:
 *   1. subcommand      — the word after the command name is being typed
 *   2. flags           — the current word starts with `-`, filtered per command
 *   3. installed skill names — before the first positional argument of the
 *      name-taking commands, obtained by shelling out to `list --names`
 *
 * This walks `$words`/`$CURRENT` itself instead of driving `_arguments`: the
 * rule the other templates implement — count the words that do not start with
 * `-` — has no `_arguments` spelling, and every extra cooperation protocol
 * (`words` getting shifted in the `args` state, spec strings) is one more way
 * to silently produce nothing, which is exactly how the original draft's zsh
 * template ended up as dead code. The contract used here is the plain one for
 * a `#compdef` function: `words[1]` is the command name, `words[2]` the
 * subcommand, `words[CURRENT]` the word being completed.
 *
 * `emulate -L zsh` keeps a user's options (noglob, err_exit, ksh_arrays)
 * from changing what this script means.
 *
 * Unlike bash, candidates need no pre-filtering: `compadd` hands them to zsh,
 * which applies the user's matcher. Whether zsh then falls back to file names
 * when nothing matched is decided by its completer chain, not by this script.
 *
 * `compdef` is defined by `compinit`, so the documented install is to evaluate
 * the output in an interactive shell where compinit has already run.
 *
 * The subcommand and flag lists are duplicated from `src/cli/index.ts`; keep
 * them in sync when a command or flag is added.
 */
export declare const zshTemplate: string;
//# sourceMappingURL=zsh.d.ts.map
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
export const zshTemplate = [
  '# zsh completion for dsh-skills-nexus - enable with:',
  '#   eval "$(dsh-skills-nexus completions --shell zsh)"',
  '# Needs compinit to have run already (it defines compdef).',
  '_dsh_skills_nexus() {',
  '  emulate -L zsh',
  '  local -a cmds skills',
  '  local cur cmd i nargs',
  '',
  '  cmds=(add list ls update pull remove rm enable disable doctor help completions)',
  '  cur=${words[CURRENT]}',
  '  cmd=${words[2]}',
  '',
  '  if (( CURRENT == 2 )); then',
  '    # Subcommand.',
  '    compadd -a cmds',
  '    return 0',
  '  fi',
  '',
  '  if [[ $cur == -* ]]; then',
  '    # Flags, filtered by subcommand. update/pull/enable/disable take none.',
  '    case $cmd in',
  '      add)         compadd -- --name --ref --subdir --yes ;;',
  '      list|ls)     compadd -- --names ;;',
  '      remove|rm)   compadd -- --yes ;;',
  '      doctor)      compadd -- --json --updates --quiet ;;',
  '      completions) compadd -- --shell ;;',
  '    esac',
  '    return 0',
  '  fi',
  '',
  '  if [[ $cmd == completions && ${words[CURRENT-1]} == --shell ]]; then',
  '    compadd -- bash zsh fish powershell',
  '    return 0',
  '  fi',
  '',
  '  # Positional arguments typed so far, ignoring flags: only the first one -',
  '  # the subcommand itself - may exist. Counting rather than comparing a fixed',
  '  # slot keeps `remove --yes <TAB>` working, because --yes is accepted before',
  '  # the names; none of these commands has a value-taking flag, so a flag value',
  '  # can never be miscounted as a positional.',
  '  nargs=0',
  '  i=3',
  '  while (( i < CURRENT )); do',
  '    [[ ${words[i]} == -* ]] || nargs=$(( nargs + 1 ))',
  '    i=$(( i + 1 ))',
  '  done',
  '',
  '  if (( nargs == 0 )); then',
  '    case $cmd in',
  '      update|pull|remove|rm|enable|disable)',
  '        # Installed skill names - ask the CLI instead of reading its state',
  '        # file, so an internal schema change cannot silently break this.',
  '        skills=(${(f)"$(dsh-skills-nexus list --names 2>/dev/null)"})',
  '        if (( ${#skills} )); then',
  '          compadd -a skills',
  '        fi',
  '        ;;',
  '    esac',
  '  fi',
  '  return 0',
  '}',
  '',
  'compdef _dsh_skills_nexus dsh-skills-nexus',
].join('\n') + '\n'

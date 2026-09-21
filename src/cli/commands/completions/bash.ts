/**
 * bash completion template for `dsh-skills-nexus completions --shell bash`.
 *
 * A plain list of ASCII lines joined on demand — deliberately NOT a template
 * literal: the script is full of `${...}` and `$(...)` that would be
 * interpolated. Keep every line a single-quoted TS string (the script uses no
 * apostrophes) and keep the content pure ASCII, so the emitted bytes match on
 * every platform and encoding.
 *
 * Three layers, mirroring what the shell knows at each point:
 *   1. subcommand      — `COMP_CWORD` 1
 *   2. flags           — the current word starts with `-`, filtered per command
 *   3. installed skill names — before the first positional argument of the
 *      name-taking commands, obtained by shelling out to `list --names`
 *
 * bash includes an empty word for a trailing space, so the word being typed is
 * always present and no in-progress-token accounting is needed.
 *
 * "First positional" counts the words before the cursor that do not start with
 * `-`, instead of comparing the word index: `remove --yes <TAB>` must still
 * offer names, because `--yes` is accepted before the names. Only update/pull/
 * remove/rm/enable/disable reach that branch and none of them has a
 * value-taking flag, so a flag value can never be miscounted as a positional —
 * giving one of them a value flag would break that invariant.
 *
 * Layer 3 goes through the CLI rather than reading `manifest.json`, so an
 * internal schema change cannot silently break completion — the isolation git
 * gets by calling `for-each-ref` instead of reading `.git/refs/`.
 *
 * No bash-completion dependency: only `compgen`/`COMPREPLY`/`COMP_WORDS` are
 * used, so this works with a bare bash as well.
 *
 * Unlike PowerShell, bash completes a bare `--` normally: `doctor --` lists all
 * three flags. PowerShell 5.1 never invokes any argument completer for a lone
 * `-`/`--` (measured against `git` as a control), so there the flags appear only
 * once a real character follows the dashes.
 *
 * The subcommand and flag lists are duplicated from `src/cli/index.ts`; keep
 * them in sync when a command or flag is added.
 */
export const bashTemplate = [
  '# bash completion for dsh-skills-nexus - enable with:',
  '#   eval "$(dsh-skills-nexus completions --shell bash)"',
  '_dsh_skills_nexus() {',
  '  local cur cmd prev flags skills i nargs',
  '  cur="${COMP_WORDS[COMP_CWORD]}"',
  '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
  '',
  '  local cmds="add list ls update pull remove rm enable disable doctor help completions"',
  '  if [ "$COMP_CWORD" -eq 1 ]; then',
  '    COMPREPLY=( $(compgen -W "$cmds" -- "$cur") )',
  '    return 0',
  '  fi',
  '',
  '  cmd="${COMP_WORDS[1]}"',
  '  case "$cmd" in',
  '    add)         flags="--name --ref --subdir --yes" ;;',
  '    list|ls)     flags="--names" ;;',
  '    remove|rm)   flags="--yes" ;;',
  '    doctor)      flags="--json --updates --quiet" ;;',
  '    completions) flags="--shell" ;;',
  '    *)           flags="" ;;',
  '  esac',
  '',
  '  if [[ "$cur" == -* ]]; then',
  '    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )',
  '    return 0',
  '  fi',
  '',
  '  if [ "$cmd" = "completions" ] && [ "$prev" = "--shell" ]; then',
  '    COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") )',
  '    return 0',
  '  fi',
  '',
  '  case "$cmd" in',
  '    update|pull|remove|rm|enable|disable)',
  '      # Positional arguments typed so far, ignoring flags.',
  '      nargs=0',
  '      i=2',
  '      while [ "$i" -lt "$COMP_CWORD" ]; do',
  '        case "${COMP_WORDS[i]}" in -*) ;; *) nargs=$((nargs + 1)) ;; esac',
  '        i=$((i + 1))',
  '      done',
  '      if [ "$nargs" -eq 0 ]; then',
  '        skills="$(dsh-skills-nexus list --names 2>/dev/null)"',
  '        COMPREPLY=( $(compgen -W "$skills" -- "$cur") )',
  '      fi',
  '      ;;',
  '  esac',
  '  return 0',
  '}',
  'complete -F _dsh_skills_nexus dsh-skills-nexus',
].join('\n') + '\n'

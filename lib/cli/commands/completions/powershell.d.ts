/**
 * PowerShell completion template for
 * `dsh-skills-nexus completions --shell powershell`.
 *
 * A plain list of ASCII lines joined on demand — deliberately NOT a template
 * literal, and every line is a double-quoted TS string while the script itself
 * uses only single-quoted PS strings, so nothing needs escaping. ASCII-only
 * matters here: PowerShell 5.1 redirects output as UTF-16LE, and keeping the
 * script byte-clean avoids any encoding surprise in generated files.
 *
 * Registered with `-Native`: measured on PS 5.1, this fires for the npm `.ps1`
 * shim (the command resolves to an ExternalScript), while a non-native
 * registration receives a mangled signature and is useless.
 *
 * Slot arithmetic is measured, not assumed. On PS 5.1 `CommandElements`
 * contains the finished tokens plus, only when it is non-empty, the token under
 * the cursor — a trailing space adds NO element. So `$done` is the number of
 * finished tokens and `$done - 2` goes negative exactly while the subcommand
 * itself is being typed. Treating a trailing space as an element would shift
 * that by one and offer subcommands while the user is typing an argument.
 *
 * The first positional argument is counted as "words before the cursor that do
 * not start with `-`", not as a fixed slot: `remove --yes <TAB>` must still
 * offer names, because `--yes` is accepted before the names. Only update/pull/
 * remove/rm/enable/disable reach that branch and none of them has a
 * value-taking flag, so a flag value can never be miscounted as a positional.
 *
 * Layer 3 shells out to `list --names` instead of reading `manifest.json`, so
 * an internal schema change cannot silently break completion.
 *
 * When the script has no candidate for the current word, PowerShell falls back
 * to file-name completion. That is engine behaviour, not something this
 * template can suppress.
 *
 * A lone `-` or `--` is never completed. Measured on PS 5.1 with `git`
 * registered as a control: while the word under the cursor is exactly `-` or
 * `--`, the engine invokes no argument completer at all, so `doctor --` yields
 * no candidates (and falls back to file names) no matter what this script does.
 * One more character — `doctor --j` — reaches this completer normally. bash
 * has no such restriction, so there `doctor --` lists every flag; see bash.ts.
 *
 * The subcommand and flag lists are duplicated from `src/cli/index.ts`; keep
 * them in sync when a command or flag is added.
 */
export declare const powershellTemplate: string;
//# sourceMappingURL=powershell.d.ts.map
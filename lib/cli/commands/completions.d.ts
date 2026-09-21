/**
 * `completions --shell <bash|zsh|fish|powershell>` - print a shell completion
 * script.
 *
 * One template per shell: the shells have incompatible completion languages
 * (bash's `complete -F` + `COMPREPLY`, zsh's `#compdef` + `compadd`, fish's
 * `complete -c`, PowerShell's `Register-ArgumentCompleter`), so there is
 * nothing to share beyond the data each template derives at run time. Each
 * template is a plain string constant and this module only picks one, so the
 * command has no logic to go wrong.
 *
 * The script is written to stdout verbatim - nothing else may be written there,
 * since the documented install is to pipe stdout straight into the shell
 * (`eval "$(...)"`, `| Out-String | Invoke-Expression`). Errors go to stderr
 * and exit 2.
 *
 * Exit codes: 0 = emitted, 2 = usage error.
 */
/**
 * Shells `--shell` accepts. An unknown name is a usage error rather than a
 * silent fallback to another shell's script, which would install something
 * that cannot work. The order is the order the templates advertise, so zsh and
 * fish sit next to bash and PowerShell keeps its place at the end.
 */
export declare const SUPPORTED_SHELLS: readonly ["bash", "zsh", "fish", "powershell"];
export type Shell = (typeof SUPPORTED_SHELLS)[number];
export interface CompletionsOptions {
    shell: Shell;
}
/**
 * Parse `completions` args. `--shell` is a value option, so both
 * `--shell bash` and `--shell=bash` work (the form every other value option in
 * this CLI accepts). A missing, empty or unknown shell is a usage error: the
 * whole point of the command is that stdout is a valid script for the shell
 * that asked for it.
 */
export declare function parseCompletionsArgs(argv: string[]): CompletionsOptions;
export declare function completions(argv: string[]): number;
//# sourceMappingURL=completions.d.ts.map
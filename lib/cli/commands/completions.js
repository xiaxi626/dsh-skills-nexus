import { bashTemplate } from './completions/bash.js';
import { fishTemplate } from './completions/fish.js';
import { powershellTemplate } from './completions/powershell.js';
import { zshTemplate } from './completions/zsh.js';
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
export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish', 'powershell'];
const TEMPLATES = {
    bash: bashTemplate,
    zsh: zshTemplate,
    fish: fishTemplate,
    powershell: powershellTemplate,
};
/**
 * Parse `completions` args. `--shell` is a value option, so both
 * `--shell bash` and `--shell=bash` work (the form every other value option in
 * this CLI accepts). A missing, empty or unknown shell is a usage error: the
 * whole point of the command is that stdout is a valid script for the shell
 * that asked for it.
 */
export function parseCompletionsArgs(argv) {
    let shell;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--shell') {
            shell = inlineVal ?? argv[++i];
            if (!shell) {
                throw new Error(`--shell requires a shell name; one of: ${SUPPORTED_SHELLS.join(', ')}`);
            }
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus completions --shell <${SUPPORTED_SHELLS.join('|')}>`);
        }
    }
    if (shell === undefined) {
        throw new Error(`--shell is required; usage: dsh-skills-nexus completions --shell <${SUPPORTED_SHELLS.join('|')}>`);
    }
    if (!SUPPORTED_SHELLS.includes(shell)) {
        throw new Error(`unsupported shell "${shell}"; supported: ${SUPPORTED_SHELLS.join(', ')}`);
    }
    return { shell: shell };
}
export function completions(argv) {
    let opts;
    try {
        opts = parseCompletionsArgs(argv);
    }
    catch (err) {
        process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 2;
    }
    process.stdout.write(TEMPLATES[opts.shell]);
    return 0;
}
//# sourceMappingURL=completions.js.map
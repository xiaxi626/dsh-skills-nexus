/** Tiny argv parser — keeps the CLI dependency-free. */
export function parseAddArgs(argv) {
    const specs = [];
    let name;
    let ref;
    let subdir;
    let yes = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--name') {
            name = inlineVal ?? argv[++i];
        }
        else if (flag === '--ref' || flag === '--branch') {
            ref = inlineVal ?? argv[++i];
        }
        else if (flag === '--subdir') {
            subdir = inlineVal ?? argv[++i];
            if (!subdir)
                throw new Error('--subdir requires a path, e.g. --subdir skills/foo');
        }
        else if (flag === '--yes' || flag === '-y' || flag === '--force') {
            // 布尔 flag 不接受值：静默丢弃 inlineVal 会让 --yes=false 变成 yes=true，
            // 从而同时绕过 add.ts 的 wrapped-skill 确认与 >20 skill 的大集合护栏。
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            yes = true;
        }
        else if (!a.startsWith('--')) {
            // 位置参数用整段 token，含 `=` 也不拆（如 owner/repo=v1）。
            // 收集全部位置参数：`add A B` 装两个仓库，不再静默丢弃靠前的（旧行为是末位覆盖）。
            specs.push(a);
        }
    }
    if (specs.length === 0) {
        throw new Error('missing repo spec, e.g. github:owner/repo');
    }
    return { specs, name, ref, subdir, yes };
}
/** First positional argument, or undefined. */
export function positional(argv) {
    return argv.find((a) => !a.startsWith('-'));
}
/**
 * Parse `remove` args: one or more names/globs plus an optional `--yes`.
 *
 * Boolean flags reject an inline value for the same reason as parseAddArgs —
 * silently dropping it would turn `--yes=false` into yes=true and bypass the
 * multi-match deletion guard (remove.ts).
 */
export function parseRemoveArgs(argv) {
    const patterns = [];
    let yes = false;
    for (const a of argv) {
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--yes' || flag === '-y' || flag === '--force') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            yes = true;
        }
        else if (!a.startsWith('-')) {
            // 名字与通配符都不以 `-` 开头（skill 名为 kebab-case），整段收集，含 `=` 也不拆。
            patterns.push(a);
        }
    }
    return { patterns, yes };
}
/**
 * Parse `list` args. `list` has no positional form and exactly one boolean flag.
 *
 * `--names` rejects an inline value for the same reason as `--yes` above:
 * `--names=false` silently becoming `names=true` would hand a scripted caller
 * the names-only stream when it asked for the human table. Unlike `add` — which
 * ignores unknown flags because it has extra options to be tolerant about —
 * unknown arguments here are usage errors: a typo like `--name` would otherwise
 * silently print the table to a script that expects one name per line.
 */
export function parseListArgs(argv) {
    let names = false;
    for (const a of argv) {
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--names') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            names = true;
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus list [--names]`);
        }
    }
    return { names };
}
//# sourceMappingURL=args.js.map
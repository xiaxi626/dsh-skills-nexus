/** Tiny argv parser — keeps the CLI dependency-free. */
export function parseAddArgs(argv) {
    let spec;
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
            spec = a;
        }
    }
    if (!spec) {
        throw new Error('missing repo spec, e.g. github:owner/repo');
    }
    return { spec, name, ref, subdir, yes };
}
/** First positional argument, or undefined. */
export function positional(argv) {
    return argv.find((a) => !a.startsWith('-'));
}
//# sourceMappingURL=args.js.map
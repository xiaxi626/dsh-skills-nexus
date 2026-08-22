/** Tiny argv parser — keeps the CLI dependency-free. */
export function parseAddArgs(argv) {
    let spec;
    let name;
    let ref;
    let yes = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--name') {
            name = argv[++i];
        }
        else if (a === '--ref' || a === '--branch') {
            ref = argv[++i];
        }
        else if (a === '--yes' || a === '-y' || a === '--force') {
            yes = true;
        }
        else if (!a.startsWith('--')) {
            spec = a;
        }
    }
    if (!spec) {
        throw new Error('missing repo spec, e.g. github:owner/repo');
    }
    return { spec, name, ref, yes };
}
/** First positional argument, or undefined. */
export function positional(argv) {
    return argv.find((a) => !a.startsWith('-'));
}
//# sourceMappingURL=args.js.map
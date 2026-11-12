/** Tiny argv parser — keeps the CLI dependency-free. */
export function parseAddArgs(argv) {
    const specs = [];
    let name;
    let ref;
    let subdir;
    let yes = false;
    let json = false;
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
        else if (flag === '--json') {
            // Boolean flags never take an inline value — see the --yes note below.
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            json = true;
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
    return { specs, name, ref, subdir, yes, json };
}
/** First positional argument, or undefined. */
export function positional(argv) {
    return argv.find((a) => !a.startsWith('-'));
}
/**
 * Parse `remove` args: one or more names/globs plus an optional `--group` and
 * `--yes`.
 *
 * Boolean flags reject an inline value for the same reason as parseAddArgs —
 * silently dropping it would turn `--yes=false` into yes=true and bypass the
 * multi-match deletion guard (remove.ts). `--group` takes a value, so the loop
 * is index-based to consume the following argument (or an inline `--group=`
 * form, like `parseToggleArgs`).
 */
export function parseRemoveArgs(argv) {
    const patterns = [];
    let yes = false;
    let json = false;
    let group;
    let project = false;
    let projectRoot;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--project') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            project = true;
        }
        else if (flag === '--project-root') {
            projectRoot = inlineVal ?? argv[++i];
            if (!projectRoot || (inlineVal === undefined && projectRoot.startsWith('--'))) {
                throw new Error('--project-root requires a path, e.g. --project-root /path/to/project');
            }
        }
        else if (flag === '--yes' || flag === '-y' || flag === '--force') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            yes = true;
        }
        else if (flag === '--json') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            json = true;
        }
        else if (flag === '--group') {
            group = inlineVal ?? argv[++i];
            if (!group)
                throw new Error('--group requires a group path, e.g. --group trae-cn/skills');
        }
        else if (!a.startsWith('-')) {
            // 名字与通配符都不以 `-` 开头（skill 名为 kebab-case），整段收集，含 `=` 也不拆。
            patterns.push(a);
        }
    }
    if (projectRoot !== undefined && !project) {
        throw new Error('--project-root requires --project (it would otherwise be silently ignored)');
    }
    if (project) {
        if (group !== undefined) {
            throw new Error('--group is not available with --project; project scope removes exact names only');
        }
        const glob = patterns.find((p) => p.includes('*') || p.includes('?'));
        if (glob !== undefined) {
            throw new Error(`"${glob}" looks like a glob; remove --project takes exact link names only`);
        }
    }
    return {
        patterns,
        yes,
        json,
        project,
        ...(group === undefined ? {} : { group }),
        ...(projectRoot === undefined ? {} : { projectRoot }),
    };
}
/**
 * Parse `list` args. `list` has no positional form and two boolean flags,
 * which are mutually exclusive: `--names` is the newline stream shell
 * completion splits on and `--json` is the structured document — asking for
 * both has no single sensible answer, so it is a usage error rather than a
 * silent precedence rule. `--filter <query>` is an optional value-taking
 * flag that narrows the output to entries whose name, URL or subdir contain
 * the query (case-insensitive).
 *
 * Both boolean flags reject an inline value for the same reason as `--yes`
 * above: `--names=false` silently becoming `names=true` would hand a scripted
 * caller the names-only stream when it asked for the human table. Unknown
 * arguments here are usage errors: a typo like `--name` would otherwise
 * silently print the table to a script that expects one name per line.
 */
export function parseListArgs(argv) {
    let names = false;
    let json = false;
    let filter;
    let project = false;
    let projectRoot;
    let all = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--names') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            names = true;
        }
        else if (flag === '--json') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            json = true;
        }
        else if (flag === '--filter') {
            filter = inlineVal ?? argv[++i];
            if (!filter)
                throw new Error('--filter requires a query string, e.g. --filter trae');
        }
        else if (flag === '--project') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            project = true;
        }
        else if (flag === '--project-root') {
            projectRoot = inlineVal ?? argv[++i];
            if (!projectRoot || (inlineVal === undefined && projectRoot.startsWith('--'))) {
                throw new Error('--project-root requires a path, e.g. --project-root /path/to/project');
            }
        }
        else if (flag === '--all') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            all = true;
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: ` +
                'dsh-skills-nexus list [--names | --json] [--filter <query>] [--project | --all] [--project-root <path>]');
        }
    }
    if (names && json) {
        throw new Error('--names and --json are mutually exclusive; --names is the newline name stream, ' +
            '--json the structured report');
    }
    if (all && (names || json)) {
        throw new Error('--all is the human scope-joined table; it cannot be combined with --names or --json');
    }
    if (all && project) {
        throw new Error('--all already includes the project scope; do not combine it with --project');
    }
    if (projectRoot !== undefined && !project) {
        throw new Error('--project-root requires --project (it would otherwise be silently ignored)');
    }
    return {
        names,
        json,
        all,
        project,
        ...(filter === undefined ? {} : { filter }),
        ...(projectRoot === undefined ? {} : { projectRoot }),
    };
}
/**
 * Parse `update` args: an optional single positional plus `--json`.
 *
 * Strict like `list`, not tolerant like `add`: `update` used to read its target
 * with `positional()` and ignore every flag, so `update --json` would have been
 * silently discarded — the exact failure mode this parser exists to prevent.
 * A second positional is rejected for the same reason: there is one target or
 * "everything enabled", and no batch form.
 */
export function parseUpdateArgs(argv) {
    const positionals = [];
    let json = false;
    for (const a of argv) {
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--json') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            json = true;
        }
        else if (!a.startsWith('-')) {
            positionals.push(a);
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus update [name] [--json]`);
        }
    }
    if (positionals.length > 1) {
        throw new Error(`update takes one entry name at a time (got ${positionals.length}); ` +
            'run it once per entry, or pass no name to refresh every enabled entry');
    }
    const target = positionals[0];
    return { ...(target === undefined ? {} : { target }), json };
}
/**
 * Parse `enable`/`disable` args: one or more names plus `--json`.
 *
 * Batch like `remove` (gap-closure A3) — `positional()` already existed and
 * `remove` already accepted several tokens, so the single-name form was the
 * asymmetry. `command` is only used for the usage wording, so the two commands
 * that share this parser still name themselves in their errors.
 */
export function parseToggleArgs(argv, command) {
    const names = [];
    let json = false;
    let group;
    let project = false;
    let projectRoot;
    let files = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--json') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            json = true;
        }
        else if (flag === '--project') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            project = true;
        }
        else if (flag === '--files') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            files = true;
        }
        else if (flag === '--project-root') {
            projectRoot = inlineVal ?? argv[++i];
            if (!projectRoot || (inlineVal === undefined && projectRoot.startsWith('--'))) {
                throw new Error('--project-root requires a path, e.g. --project-root /path/to/project');
            }
        }
        else if (flag === '--group') {
            group = inlineVal ?? argv[++i];
            if (!group)
                throw new Error('--group requires a path, e.g. --group trae-cn/skills');
        }
        else if (!a.startsWith('-')) {
            // 名字不以 `-` 开头（skill 名为 kebab-case），整段收集，含 `=` 也不拆。
            names.push(a);
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus ${command} <name>... [--group <path>] [--json]`);
        }
    }
    if (files && !project) {
        throw new Error('--files requires --project (it only moves real project-skill directories)');
    }
    if (files && group !== undefined) {
        throw new Error('--files cannot combine with --group; both target exact names');
    }
    if (projectRoot !== undefined && !project) {
        throw new Error('--project-root requires --project (it would otherwise be silently ignored)');
    }
    if (project && group !== undefined) {
        throw new Error('--group is not available with --project; project scope toggles exact link names only');
    }
    if (names.length === 0 && !group) {
        throw new Error(project
            ? `missing link name; usage: dsh-skills-nexus ${command} --project <name>... [--project-root <path>] [--json]`
            : `missing skill name; usage: dsh-skills-nexus ${command} <name>... [--group <path>] [--json]`);
    }
    return {
        names,
        json,
        ...(group === undefined ? {} : { group }),
        ...(project ? { project: true } : {}),
        ...(projectRoot === undefined ? {} : { projectRoot }),
        ...(files ? { files: true } : {}),
    };
}
/**
 * Parse `export` args: entry names or `--all`, plus an optional `--out`.
 *
 * Unlike `add` (which has per-repo options and therefore tolerates unknown
 * flags) this rejects anything it does not know: `export` writes a file whose
 * name is derived from what it was given, so a typo silently falling back to
 * "export everything" would be worse than a usage error. `--all` and explicit
 * names are mutually exclusive for the same reason — asking for one entry and
 * silently getting the whole manifest is not a recoverable surprise.
 *
 * `--out` is the only value-taking option here; `-o` is accepted as an alias
 * and is deliberately absent from `--help`'s option list (the shell templates
 * advertise long options only, matching `-y` for `--yes`).
 */
export function parseExportArgs(argv) {
    const names = [];
    let all = false;
    let out;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--all') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            all = true;
        }
        else if (flag === '--out' || flag === '-o') {
            out = inlineVal ?? argv[++i];
            if (!out)
                throw new Error(`${flag} requires a path, e.g. --out skills.zip`);
        }
        else if (!a.startsWith('-')) {
            names.push(a);
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus export <name>... | --all [--out <file>]`);
        }
    }
    if (all && names.length > 0) {
        throw new Error('--all packages every entry; do not combine it with entry names');
    }
    if (!all && names.length === 0) {
        throw new Error('nothing to export; usage: dsh-skills-nexus export <name>... | --all [--out <file>]');
    }
    return { names, all, out };
}
/**
 * Parse `import` args: exactly one package path plus its modifiers.
 *
 * Strict like `export` and `list`, not tolerant like `add`: every flag here
 * changes what lands on disk, and a typo that turned `--dry-run` into a real
 * import (or `--no-remote` into a clone) is not something the user can undo by
 * re-running. A second positional is rejected for the same reason — a package
 * path with a stray word after it is a mistake, not a batch.
 */
export function parseImportArgs(argv) {
    const positionals = [];
    let dryRun = false;
    let noNetCheck = false;
    let noRemote = false;
    let locked = false;
    let each = false;
    let force = false;
    let yes = false;
    let name;
    let subdir;
    const boolean = (flag, inlineVal) => {
        if (inlineVal !== undefined) {
            throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
        }
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        switch (flag) {
            case '--dry-run':
                boolean(flag, inlineVal);
                dryRun = true;
                break;
            case '--no-net-check':
                boolean(flag, inlineVal);
                noNetCheck = true;
                break;
            case '--no-remote':
                boolean(flag, inlineVal);
                noRemote = true;
                break;
            case '--locked':
                boolean(flag, inlineVal);
                locked = true;
                break;
            case '--each':
                boolean(flag, inlineVal);
                each = true;
                break;
            case '--force':
                boolean(flag, inlineVal);
                force = true;
                break;
            case '--yes':
            case '-y':
                boolean(flag, inlineVal);
                yes = true;
                break;
            case '--name':
                name = inlineVal ?? argv[++i];
                if (!name)
                    throw new Error('--name requires a name, e.g. --name my-skill');
                break;
            case '--subdir':
                subdir = inlineVal ?? argv[++i];
                if (!subdir)
                    throw new Error('--subdir requires a path, e.g. --subdir skills/foo');
                break;
            default:
                if (a.startsWith('-')) {
                    throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus import <package> [--dry-run] [--subdir <path>]`);
                }
                positionals.push(a);
        }
    }
    if (locked && (noRemote || noNetCheck)) {
        throw new Error('--locked is mutually exclusive with --no-remote and --no-net-check');
    }
    if (positionals.length === 0) {
        throw new Error('missing package path; usage: dsh-skills-nexus import <package> [--dry-run]');
    }
    if (positionals.length > 1) {
        throw new Error(`import takes one package at a time (got ${positionals.length}); run it once per package`);
    }
    return {
        source: positionals[0],
        dryRun,
        noNetCheck,
        noRemote,
        locked,
        each,
        force,
        ...(name === undefined ? {} : { name }),
        ...(subdir === undefined ? {} : { subdir }),
        yes,
    };
}
/**
 * Parse `purge` args: two boolean flags, nothing else.
 *
 * `purge` has no positional arguments and no value-taking options — it scans a
 * fixed set of artifact categories and either reports or deletes them. Unknown
 * arguments are usage errors: a typo like `--yess` would otherwise silently
 * turn an actual purge into a dry-run, and the user would wonder why nothing
 * was cleaned up.
 *
 * Both boolean flags reject an inline value for the same reason as `--yes` in
 * `parseAddArgs`: `--yes=false` silently becoming yes=true would bypass the
 * dry-run safety net.
 */
export function parsePurgeArgs(argv) {
    let yes = false;
    let json = false;
    for (const a of argv) {
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        if (flag === '--yes' || flag === '-y') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            yes = true;
        }
        else if (flag === '--json') {
            if (inlineVal !== undefined) {
                throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
            }
            json = true;
        }
        else {
            throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus purge [--yes] [--json]`);
        }
    }
    return { yes, json };
}
/**
 * Parse `adopt` args: exactly one entry name plus the source to attach.
 *
 * Strict like `import`/`export`/`list`, not tolerant like `add`: this command
 * replaces a directory the user may still need, and every flag here changes
 * what that replacement is. A typo that turned `--prune` into "keep" (or
 * `--subdir` into "the clone root") would be discovered only after the old
 * directory had been moved aside, so unknown arguments are usage errors.
 *
 * `--url` is required rather than inferred: §6 forbids URL guessing outright,
 * and the one thing this command must never do is adopt the wrong repository.
 * A second positional is rejected for the same reason a missing one is — the
 * name identifies which entry to re-source, and there is no batch form.
 */
export function parseAdoptArgs(argv) {
    const positionals = [];
    let url;
    let ref;
    let subdir;
    let force = false;
    let prune = false;
    const boolean = (flag, inlineVal) => {
        if (inlineVal !== undefined) {
            throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
        }
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        // 按第一个 `=` 拆分 --flag=value；无 `=` 时 inlineVal 为 undefined。
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        switch (flag) {
            case '--force':
                boolean(flag, inlineVal);
                force = true;
                break;
            case '--prune':
                boolean(flag, inlineVal);
                prune = true;
                break;
            case '--url':
                url = inlineVal ?? argv[++i];
                if (!url)
                    throw new Error('--url requires a repository URL, e.g. --url owner/repo');
                break;
            case '--ref':
                ref = inlineVal ?? argv[++i];
                if (!ref)
                    throw new Error('--ref requires a branch, tag or commit');
                break;
            case '--subdir':
                subdir = inlineVal ?? argv[++i];
                if (!subdir)
                    throw new Error('--subdir requires a path, e.g. --subdir skills/foo');
                break;
            default:
                if (a.startsWith('-')) {
                    throw new Error(`unknown argument "${a}"; usage: ` +
                        `dsh-skills-nexus adopt <name> --url <repo> [--ref <ref>] [--subdir <path>] [--force] [--prune]`);
                }
                positionals.push(a);
        }
    }
    if (positionals.length === 0) {
        throw new Error('missing skill name; usage: dsh-skills-nexus adopt <name> --url <repo> [--force] [--prune]');
    }
    if (positionals.length > 1) {
        throw new Error(`adopt takes one entry name at a time (got ${positionals.length}); run it once per entry`);
    }
    if (url === undefined) {
        throw new Error('--url is required: adopt attaches a source and never guesses one ' +
            '(usage: dsh-skills-nexus adopt <name> --url <repo>)');
    }
    return {
        name: positionals[0],
        url,
        force,
        prune,
        ...(ref === undefined ? {} : { ref }),
        ...(subdir === undefined ? {} : { subdir }),
    };
}
/**
 * Parse `link` args: one source positional plus optional flags.
 *
 * Strict like `import`: the source is required and unknown flags are usage
 * errors. `--group <name>` sets the L1 group name (default = source value).
 * --source-dir 为源无关的根目录覆盖，--trae-cn-dir 保留兼容。
 */
export function parseLinkArgs(argv) {
    const positionals = [];
    let dirOverride;
    let traeCnDir;
    let group;
    let force = false;
    let dryRun = false;
    let json = false;
    let project = false;
    let projectRoot;
    const boolean = (flag, inlineVal) => {
        if (inlineVal !== undefined) {
            throw new Error(`${flag} takes no value (got "${inlineVal}"); use ${flag} alone`);
        }
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eqIdx = a.indexOf('=');
        const flag = eqIdx !== -1 ? a.slice(0, eqIdx) : a;
        const inlineVal = eqIdx !== -1 ? a.slice(eqIdx + 1) : undefined;
        switch (flag) {
            case '--source-dir':
                dirOverride = inlineVal ?? argv[++i];
                if (!dirOverride || (inlineVal === undefined && dirOverride.startsWith('--'))) {
                    throw new Error('--source-dir requires a path, e.g. --source-dir /path/to/.trae');
                }
                break;
            case '--trae-cn-dir':
                traeCnDir = inlineVal ?? argv[++i];
                if (!traeCnDir)
                    throw new Error('--trae-cn-dir requires a path, e.g. --trae-cn-dir /path/to/.trae-cn');
                break;
            case '--group':
                group = inlineVal ?? argv[++i];
                if (!group)
                    throw new Error('--group requires a name, e.g. --group my-skills');
                break;
            case '--force':
                boolean(flag, inlineVal);
                force = true;
                break;
            case '--dry-run':
                boolean(flag, inlineVal);
                dryRun = true;
                break;
            case '--json':
                boolean(flag, inlineVal);
                json = true;
                break;
            case '--project':
                boolean(flag, inlineVal);
                project = true;
                break;
            case '--project-root':
                projectRoot = inlineVal ?? argv[++i];
                if (!projectRoot || (inlineVal === undefined && projectRoot.startsWith('--'))) {
                    throw new Error('--project-root requires a path, e.g. --project-root /path/to/project');
                }
                break;
            default:
                if (a.startsWith('-')) {
                    throw new Error(`unknown argument "${a}"; usage: dsh-skills-nexus link <source> [--dry-run] [--group <name>] [--force] [--json]` +
                        ' or: dsh-skills-nexus link --project <dir> [--project-root <path>] [--dry-run] [--json]');
                }
                positionals.push(a);
        }
    }
    if (projectRoot !== undefined && !project) {
        throw new Error('--project-root requires --project (it would otherwise be silently ignored)');
    }
    if (project && (dirOverride !== undefined || traeCnDir !== undefined || group !== undefined || force)) {
        throw new Error('--project links a directory: --group, --source-dir, --trae-cn-dir and --force do not apply');
    }
    if (positionals.length === 0) {
        throw new Error(project
            ? 'missing directory; usage: dsh-skills-nexus link --project <dir> [--dry-run] [--json]'
            : 'missing source; usage: dsh-skills-nexus link <source> [--dry-run] [--group <name>] [--force] [--json]');
    }
    if (positionals.length > 1) {
        const what = project ? 'directory' : 'source';
        throw new Error(`link takes one ${what} at a time (got ${positionals.length}); run it once per ${what}`);
    }
    return {
        source: positionals[0],
        force,
        dryRun,
        json,
        project,
        ...(dirOverride === undefined ? {} : { dirOverride }),
        ...(traeCnDir === undefined ? {} : { traeCnDir }),
        ...(group === undefined ? {} : { group }),
        ...(projectRoot === undefined ? {} : { projectRoot }),
    };
}
//# sourceMappingURL=args.js.map
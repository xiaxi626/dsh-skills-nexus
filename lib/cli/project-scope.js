import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { detectProjectRoot } from '../project-root.js';
export async function resolveProjectScope(projectRoot) {
    if (projectRoot === undefined)
        return { root: detectProjectRoot(process.cwd()) };
    const root = resolve(projectRoot);
    try {
        if ((await stat(root)).isDirectory())
            return { root };
    }
    catch {
        // fall through to the shared error
    }
    return { error: `project root "${root}" does not exist or is not a directory` };
}
//# sourceMappingURL=project-scope.js.map
import { stat, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
/**
 * Reflectively read the workspace registry from an host context. Returns
 * `undefined` when the host does not expose it (headless / CLI profile).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function workspaceRegistryOf(ctx) {
    if (!ctx || typeof ctx.get !== 'function')
        return undefined;
    try {
        const registry = ctx.get('workspaceRegistry');
        if (registry && typeof registry.list === 'function') {
            return registry;
        }
    }
    catch {
        // ctx.get may throw when the key is absent — treat as unavailable.
    }
    return undefined;
}
/** Walk ancestors until we find a directory containing `.git`. Returns root. */
export async function detectProjectRoot(start) {
    let cur = start;
    // Safety cap: never climb past the filesystem root (dirname of root = root).
    for (let i = 0; i < 32; i++) {
        try {
            await stat(join(cur, '.git'));
            return cur;
        }
        catch {
            const parent = dirname(cur);
            if (parent === cur)
                break;
            cur = parent;
        }
    }
    return start;
}
/** Normalise one opaque host row into a WorkspaceRow we can serve. */
function normaliseRow(row) {
    if (row == null || typeof row !== 'object')
        return null;
    const obj = row;
    const path = typeof obj.path === 'string' ? obj.path : undefined;
    if (!path)
        return null;
    return {
        id: typeof obj.id === 'string' ? obj.id : path,
        path,
        title: typeof obj.title === 'string' ? obj.title : '',
        // detectProjectRoot is async — caller awaits before filling this in.
        projectRoot: path,
        exists: true,
    };
}
export async function listWorkspaces(registry) {
    const raw = registry.list();
    const rows = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const r of rows) {
        const norm = normaliseRow(r);
        if (!norm)
            continue;
        try {
            await stat(norm.path);
            norm.exists = true;
        }
        catch {
            norm.exists = false;
        }
        norm.projectRoot = await detectProjectRoot(norm.path);
        out.push(norm);
    }
    return out;
}
/**
 * Resolve the user-supplied workspace path against the registry. The path in
 * the request is treated as an **authorisation key** — we never trust it
 * directly; we cross-check against registered rows first, then verify the
 * resulting .dsh chain is not a symlink that would redirect writes outside
 * the workspace.
 */
export async function resolveWorkspaceTarget(registry, requested) {
    // Must be absolute. Accept POSIX `/` start or Windows drive letter.
    const isAbs = requested.startsWith('/') || /^[A-Za-z]:/.test(requested);
    if (!requested || !isAbs) {
        return { ok: false, reason: 'invalid-path' };
    }
    let rows;
    try {
        rows = await listWorkspaces(registry);
    }
    catch {
        return { ok: false, reason: 'unavailable' };
    }
    const match = rows.find((r) => r.path === requested);
    if (!match)
        return { ok: false, reason: 'unregistered' };
    // .dsh / .dsh/skills / .dsh/skills-disabled must be real directories — a
    // symlink here would let the caller redirect writes to arbitrary paths.
    for (const rel of ['.dsh', join('.dsh', 'skills'), join('.dsh', 'skills-disabled')]) {
        const p = join(match.projectRoot, rel);
        try {
            const st = await lstat(p);
            if (st.isSymbolicLink())
                return { ok: false, reason: 'unsafe-root' };
        }
        catch {
            // Missing directories are fine — they'll be created on demand.
        }
    }
    return { ok: true, path: match.projectRoot };
}
//# sourceMappingURL=workspaces.js.map
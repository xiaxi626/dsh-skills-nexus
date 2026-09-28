/**
 * Shared helpers for the `/skills-nexus/*` routes: the unified response
 * envelope (§7.1 约定 2), method gating (约定 6), same-origin / loopback
 * guards (§12.1) and small body/query readers.
 */
import { HttpError } from './types.js';
export const JSON_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};
/**
 * §7.1 约定 2: success is `{ data, hotReload }`; the async-acceptance envelope
 * is exactly `202 { data: { jobId } }`, so `hotReload` is omitted when undefined.
 */
export function sendData(res, data, hotReload, status = 200) {
    const payload = { data };
    if (hotReload !== undefined)
        payload.hotReload = hotReload;
    sendJson(res, status, payload);
}
export function sendError(res, status, error, data, extraHeaders) {
    const payload = { error };
    if (data !== undefined)
        payload.data = data;
    sendJson(res, status, payload, extraHeaders);
}
function sendJson(res, status, payload, extraHeaders) {
    res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
    res.end(JSON.stringify(payload));
}
/** §7.1 约定 6: method mismatch → `405 { error }` + `allow` header. */
export function requireMethod(req, res, method) {
    if ((req.method ?? 'GET').toUpperCase() === method)
        return true;
    sendError(res, 405, `method not allowed (use ${method})`, undefined, { allow: method });
    return false;
}
export function header(req, name) {
    const v = req.headers?.[name.toLowerCase()];
    if (Array.isArray(v))
        return v[0];
    return v;
}
/**
 * §12.1 same-origin: a missing `Origin` passes — the host listens on loopback
 * and non-browser clients (curl, tests) send no Origin at all. A present but
 * host-mismatched Origin is rejected by the caller with 403.
 */
export function sameOrigin(req) {
    const origin = header(req, 'origin');
    if (origin === undefined)
        return true;
    const host = header(req, 'host');
    if (host === undefined)
        return false;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}
export function isLoopback(req) {
    const addr = req.socket?.remoteAddress ?? '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
/** Guard for the mutation/network routes: same-origin is mandatory (§12.1). */
export function requireMutationSafe(req, res) {
    if (sameOrigin(req))
        return true;
    sendError(res, 403, 'untrusted origin');
    return false;
}
/** Read the raw body up to `capBytes` (413 beyond). */
export async function readBody(req, capBytes) {
    const chunks = [];
    let total = 0;
    await new Promise((resolve, reject) => {
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > capBytes) {
                reject(new HttpError(413, 'payload-too-large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve());
        req.on('error', (err) => reject(err));
    });
    return Buffer.concat(chunks);
}
/** Parse a JSON object body; `{}` when empty, 400 `invalid-json` otherwise. */
export async function readJson(req) {
    const raw = await readBody(req, 1024 * 1024);
    if (raw.length === 0)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    }
    catch {
        throw new HttpError(400, 'invalid-json');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new HttpError(400, 'invalid-json');
    }
    return parsed;
}
/** Query string of the request URL, per the Node `req.url` shape. */
export function queryOf(req) {
    const url = req.url ?? '';
    const q = url.indexOf('?');
    return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}
export function strField(body, key) {
    const v = body[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}
export function boolField(body, key) {
    const v = body[key];
    return typeof v === 'boolean' ? v : undefined;
}
//# sourceMappingURL=util.js.map
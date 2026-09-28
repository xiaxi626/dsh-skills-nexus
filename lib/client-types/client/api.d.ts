/**
 * The typed client for the `/skills-nexus/*` routes (§10.1).
 *
 * One fetch wrapper per §7.1 dialect: success envelopes unwrap to
 * `{ data, hotReload }`; failures throw `ApiError` carrying the status, the
 * `error` code and the optional `data` payload. The destructive routes rely on
 * the server's `409 confirm-required` as the single source of the consequence
 * wording (§12.2) — `confirmable()` plays the ask-then-retry flow on top of it.
 *
 * The transport is injectable as a narrow structural type so the whole module
 * is unit-testable in Node without a server, and so the browser bundle keeps
 * its only platform dependency on `fetch` itself. Contract types are declared
 * here on purpose (client-side mirror of the server responses, not an import
 * across the bundler/node module-resolution split).
 */
/** Response surface this client needs (a subset of the DOM `Response`). */
export interface ApiFetchResponse {
    readonly status: number;
    json(): Promise<unknown>;
}
export interface ApiFetchInit {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | FormData;
}
/** Injectable transport — the real `fetch` satisfies this shape. */
export type ApiFetch = (input: string, init?: ApiFetchInit) => Promise<ApiFetchResponse>;
export type HotReload = 'pending' | 'done' | 'unsupported';
/** One envelope-level failure: status + `{ error, data? }` (§7.1 约定 2/4). */
export declare class ApiError extends Error {
    readonly status: number;
    readonly error: string;
    readonly data?: unknown | undefined;
    constructor(status: number, error: string, data?: unknown | undefined);
}
export interface Envelope<T> {
    data: T;
    hotReload?: HotReload;
}
export interface ListLink {
    linkName: string;
    skillName: string;
    enabled: boolean;
}
export interface UpdateStatus {
    hasUpdate: boolean;
    latestCommit: string | null;
    checkedAt: string;
}
export interface ListEntry {
    name: string;
    url: string;
    ref: string;
    subdir: string | null;
    commit: string | null;
    source: string;
    enabled: boolean;
    links: ListLink[];
    update: UpdateStatus | null;
}
export interface DoctorReport {
    version: number;
    checks: Array<{
        id: string;
        status: string;
        detail?: string;
        issues: unknown[];
    }>;
    summary: {
        errors: number;
        warnings: number;
        updates: number;
    };
}
export type JobKind = 'add' | 'add-zip' | 'update' | 'switch-version';
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';
/** §7.5 Job schema as `GET /job` serves it. */
export interface Job {
    id: string;
    kind: JobKind;
    name: string;
    status: JobStatus;
    stage?: string;
    detail?: string;
    output: string[];
    error?: string;
    startedAt: string;
    endedAt?: string;
}
export interface AddBody {
    url: string;
    ref?: string;
    subdir?: string;
    confirm?: boolean;
}
export interface SwitchVersionBody {
    name: string;
    ref: string;
    refType?: 'branch' | 'tag' | 'commit';
    confirm?: boolean;
}
export interface NexusApi {
    list(): Promise<Envelope<{
        entries: ListEntry[];
    }>>;
    doctor(): Promise<Envelope<DoctorReport>>;
    add(body: AddBody): Promise<Envelope<{
        jobId: string;
    }>>;
    addZip(file: File): Promise<Envelope<{
        jobId: string;
    }>>;
    remove(name: string, confirm?: boolean): Promise<Envelope<{
        name: string;
        removed: boolean;
        links: string[];
    }>>;
    update(name: string, confirm?: boolean): Promise<Envelope<{
        jobId: string;
    }>>;
    checkUpdates(): Promise<Envelope<{
        results: unknown;
    }>>;
    switchVersion(body: SwitchVersionBody): Promise<Envelope<{
        jobId: string;
    }>>;
    toggle(name: string, enabled: boolean): Promise<Envelope<{
        name: string;
        enabled: boolean;
        links: Array<{
            linkName: string;
            enabled: boolean;
        }>;
    }>>;
    job(id: string): Promise<Envelope<{
        job: Job;
    }>>;
    cancelJob(id: string): Promise<Envelope<{
        id: string;
        status: JobStatus;
    }>>;
}
/**
 * Build the api object over an injectable transport. The default binds the
 * global `fetch` (the browser half runs same-origin — paths only, no host).
 */
export declare function createApi(fetchImpl?: ApiFetch): NexusApi;
/** True for the `409 confirm-required` dialect the destructive routes answer. */
export declare function isConfirmRequired(err: unknown): err is ApiError;
/** The `data.question` of a confirm-required error, when present. */
export declare function confirmQuestion(err: unknown): string | undefined;
/**
 * The ask-then-retry flow: run `fn(false)`; on a confirm-required answer show
 * the server's question through `ask`, and — only if the user accepts — run
 * `fn(true)`. Any other error propagates; a declined ask resolves `undefined`.
 */
export declare function confirmable<T>(fn: (confirm: boolean) => Promise<T>, ask: (question: string) => Promise<boolean>): Promise<T | undefined>;
/** The question inside an errored job (`NeedsConfirm` → job error, §7.5). */
export declare function jobConfirmationQuestion(job: Job): string | undefined;
/** `pollJob` gave up waiting — the job is still `running` past `maxWaitMs`. */
export declare class PollTimeoutError extends Error {
    readonly job: Job;
    constructor(job: Job);
}
export interface PollOptions {
    /** Interval between polls (default 1000ms). */
    intervalMs?: number;
    /** Give up polling after this long (default 10 minutes). */
    maxWaitMs?: number;
    /** Injectable sleep — tests resolve immediately. */
    sleep?: (ms: number) => Promise<void>;
    /** Called after every poll (running or not). */
    onTick?: (job: Job) => void;
}
/**
 * Poll `GET /job?id=` until the job leaves `running`. Resolves the settled
 * job; throws `PollTimeoutError` (carrying the last snapshot) past the
 * deadline — the job itself keeps running server-side and can still be
 * cancelled or found by a later poll.
 */
export declare function pollJob(api: NexusApi, id: string, opts?: PollOptions): Promise<Job>;
/** `reconcileList` gave up before the list reflected the mutation. */
export declare class ReconcileTimeoutError extends Error {
    readonly entries: ListEntry[];
    constructor(entries: ListEntry[]);
}
export interface ReconcileOptions {
    /** Interval between polls (default 250ms). */
    intervalMs?: number;
    /** Give up after this long (default 2000ms — the §11 budget). */
    timeoutMs?: number;
    /** Injectable sleep — tests resolve immediately. */
    sleep?: (ms: number) => Promise<void>;
    /** Called after every poll that did not yet satisfy `until`. */
    onTick?: (entries: ListEntry[]) => void;
}
/**
 * §11 reconciliation for a `hotReload: 'pending'` mutation: poll `list` until
 * `until` accepts the snapshot — i.e. the link change the host watcher is
 * about to confirm is visible. Resolves the accepted snapshot; throws
 * `ReconcileTimeoutError` (carrying the last snapshot) past the deadline —
 * the caller downgrades to a manual-refresh hint.
 */
export declare function reconcileList(api: NexusApi, until: (entries: ListEntry[]) => boolean, opts?: ReconcileOptions): Promise<ListEntry[]>;
//# sourceMappingURL=api.d.ts.map
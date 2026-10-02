/**
 * Long-operation job channel (§7.5): add / update / switch-version are
 * accepted as `202 { data: { jobId } }` and execute in the background;
 * progress is polled via `GET /skills-nexus/job?id=`.
 *
 * Jobs live in an in-process Map — runtime data, never persisted (same rule
 * as the update cache, §5.2). A process restart loses the records; the disk
 * truth source remains manifest + doctor.
 *
 * Cancellation is best-effort (§7.5): the job's io checks the cancel flag at
 * every progress/emit boundary and aborts between steps. A git child already
 * running is not killed (no AbortSignal plumbing in the git layer); the add
 * rollback standard (rm of partial clones) still applies on the way out.
 */
import type { OpsIO } from '../ops-io.js';
export type JobKind = 'add' | 'import' | 'adopt' | 'update' | 'switch-version';
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';
/** §7.5 Job schema — polling contract for the UI; do not add fields lightly. */
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
export declare class JobCancelledError extends Error {
    readonly jobId: string;
    constructor(jobId: string);
}
export declare function createJob(kind: JobKind, name: string): Job;
export declare function getJob(id: string): Job | undefined;
/**
 * `POST /skills-nexus/job/cancel` (§7.5): flag a running job for best-effort
 * cancellation; a job that already finished is a no-op. Returns the job, or
 * `undefined` for an unknown id (route → 404).
 */
export declare function requestCancel(id: string): Job | undefined;
/** True once cancellation has been requested for a still-running job. */
export declare function isCancelRequested(id: string): boolean;
/**
 * Execute `op` in the background under the job's already-held locks. The
 * route acquired the per-skill flight + file lock at acceptance time (§7.5
 * 受理即锁) and passes `release` (releases both, plus the flight slot) here;
 * it runs exactly once in the `finally`.
 */
export declare function runJob(job: Job, release: () => Promise<void>, op: (io: OpsIO) => Promise<void>): void;
//# sourceMappingURL=jobs.d.ts.map
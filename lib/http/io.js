/**
 * `httpIO` (§4.2): the OpsIO implementation behind the job channel. Progress
 * lines land on the job record (`stage` / `detail` / `output`) so `GET /job`
 * can poll them; `confirm` can never prompt — it raises `NeedsConfirm`, which
 * the runner surfaces as a job error carrying the question.
 */
import { NeedsConfirm } from '../ops-io.js';
import { isCancelRequested, JobCancelledError } from './jobs.js';
/** Keep the polled output bounded — the job record is runtime-only UI data. */
const OUTPUT_LIMIT = 200;
export function jobIO(job) {
    return {
        interactive: false,
        confirm(question, defaultValue) {
            return Promise.reject(new NeedsConfirm(question, defaultValue));
        },
        progress(stage, detail) {
            if (isCancelRequested(job.id))
                throw new JobCancelledError(job.id);
            job.stage = stage;
            job.detail = detail;
        },
        emit(text) {
            if (isCancelRequested(job.id))
                throw new JobCancelledError(job.id);
            job.output.push(text);
            if (job.output.length > OUTPUT_LIMIT) {
                job.output.splice(0, job.output.length - OUTPUT_LIMIT);
            }
        },
    };
}
/**
 * A silent OpsIO for synchronous routes (list / doctor / check-updates):
 * nothing to record, nothing to prompt — a confirm reaching here is a bug
 * and fails loudly as `NeedsConfirm` instead of hanging.
 */
export const quietIO = {
    interactive: false,
    confirm(question, defaultValue) {
        return Promise.reject(new NeedsConfirm(question, defaultValue));
    },
    progress() {
        // synchronous route — progress lines have nowhere to go
    },
    emit() {
        // synchronous route — output is the response body itself
    },
};
//# sourceMappingURL=io.js.map
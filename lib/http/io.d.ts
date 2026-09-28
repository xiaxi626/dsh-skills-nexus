/**
 * `httpIO` (§4.2): the OpsIO implementation behind the job channel. Progress
 * lines land on the job record (`stage` / `detail` / `output`) so `GET /job`
 * can poll them; `confirm` can never prompt — it raises `NeedsConfirm`, which
 * the runner surfaces as a job error carrying the question.
 */
import type { OpsIO } from '../ops-io.js';
import type { Job } from './jobs.js';
export declare function jobIO(job: Job): OpsIO;
/**
 * A silent OpsIO for synchronous routes (list / doctor / check-updates):
 * nothing to record, nothing to prompt — a confirm reaching here is a bug
 * and fails loudly as `NeedsConfirm` instead of hanging.
 */
export declare const quietIO: OpsIO;
//# sourceMappingURL=io.d.ts.map
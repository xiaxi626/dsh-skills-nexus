/**
 * `httpIO` (§4.2): the OpsIO implementation behind the job channel. Progress
 * lines land on the job record (`stage` / `detail` / `output`) so `GET /job`
 * can poll them; `confirm` can never prompt — it raises `NeedsConfirm`, which
 * the runner surfaces as a job error carrying the question.
 */

import { NeedsConfirm } from '../ops-io.js'
import type { OpsIO } from '../ops-io.js'
import { isCancelRequested, JobCancelledError } from './jobs.js'
import type { Job } from './jobs.js'

/** Keep the polled output bounded — the job record is runtime-only UI data. */
const OUTPUT_LIMIT = 200

export function jobIO(job: Job): OpsIO {
  const progress = (stage: string, detail?: string): void => {
    if (isCancelRequested(job.id)) throw new JobCancelledError(job.id)
    job.stage = stage
    job.detail = detail
  }
  return {
    interactive: false,
    confirm(question: string, defaultValue: boolean): Promise<boolean> {
      return Promise.reject(new NeedsConfirm(question, defaultValue))
    },
    progress,
    emit(text: string): void {
      if (isCancelRequested(job.id)) throw new JobCancelledError(job.id)
      job.output.push(text)
      if (job.output.length > OUTPUT_LIMIT) {
        job.output.splice(0, job.output.length - OUTPUT_LIMIT)
      }
    },
    /**
     * A diagnostic is output the user must see, and the job record is the only
     * channel the panel polls — so it lands on `output` beside the batch lines
     * rather than vanishing into a server log. A `stderr` write here would be
     * invisible in the panel, which is the whole point of collecting the shared
     * code's diagnostics into OpsIO (A1).
     */
    error(text: string): void {
      if (isCancelRequested(job.id)) throw new JobCancelledError(job.id)
      job.output.push(text)
      if (job.output.length > OUTPUT_LIMIT) {
        job.output.splice(0, job.output.length - OUTPUT_LIMIT)
      }
    },
    /**
     * A job record is polled, not watched: it must never receive the CLI's
     * `\r`-animated spinner. Reporting the stage first keeps the same signal
     * the CLI's own `io.progress('cloning', …)` set (and doubles as the
     * cancellation checkpoint), then the step runs inline.
     */
    async spin<T>(message: string, fn: () => Promise<T>): Promise<T> {
      const stage = spinnerStage(message)
      if (stage !== undefined) progress(stage[0], stage[1])
      return await fn()
    },
  }
}

/**
 * The `progress` stage a spinner message maps to, or undefined when the step
 * has no stage of its own. Install cores name their step as
 * `cloning (<ref>)` — the CLI's spinner label — which becomes the
 * `('cloning', '<ref>')` pair the panel reported before this seam existed.
 */
function spinnerStage(message: string): [string, string | undefined] | undefined {
  const match = /^([a-z][a-z-]*) \(([^)]*)\)$/.exec(message)
  if (match !== null) return [match[1]!, match[2]!]
  return /^[a-z][a-z-]*$/.test(message) ? [message, undefined] : undefined
}

/**
 * A silent OpsIO for synchronous routes (list / doctor / check-updates):
 * nothing to record, nothing to prompt — a confirm reaching here is a bug
 * and fails loudly as `NeedsConfirm` instead of hanging.
 */
export const quietIO: OpsIO = {
  interactive: false,
  confirm(question: string, defaultValue: boolean): Promise<boolean> {
    return Promise.reject(new NeedsConfirm(question, defaultValue))
  },
  progress(): void {
    // synchronous route — progress lines have nowhere to go
  },
  emit(): void {
    // synchronous route — output is the response body itself
  },
  error(): void {
    // synchronous route — a failure is the error envelope, built by the route
    // from the thrown value; a stderr line here would be a server log nothing
    // in the response surface explains.
  },
  spin<T>(_message: string, fn: () => Promise<T>): Promise<T> {
    // synchronous route — no job record to report a stage to; just run the step
    return fn()
  },
}

/** EventBridge scheduled rule → idempotent maintenance job. */
import { getRuntime } from "@/server/runtime";
import { JOB_NAMES, type JobName } from "@/server/services/jobs-service";

export async function handler(event: { job?: string }) {
  const job = event.job as JobName;
  if (!JOB_NAMES.includes(job)) throw new Error(`Unknown job "${String(event.job)}"`);
  const runtime = await getRuntime();
  return runtime.services.jobs.run(job);
}

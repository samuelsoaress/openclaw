import type { CronConfig } from "../config/types.cron.js";
import type { CronOverlapPolicy } from "./types.js";

const DEFAULT_MAX_QUEUE_DEPTH = 3;
const DEFAULT_MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // 30 minutes

export function resolveCronOverlapPolicy(
  job: { overlapPolicy?: CronOverlapPolicy },
  cronConfig?: Pick<CronConfig, "overlapPolicy">,
): CronOverlapPolicy {
  return job.overlapPolicy ?? cronConfig?.overlapPolicy ?? "allow";
}

export function resolveCronMaxQueueDepth(cronConfig?: Pick<CronConfig, "maxQueueDepth">): number {
  const raw = cronConfig?.maxQueueDepth;
  return typeof raw === "number" && raw > 0 ? raw : DEFAULT_MAX_QUEUE_DEPTH;
}

export function resolveCronMaxQueueAgeMs(cronConfig?: Pick<CronConfig, "maxQueueAgeMs">): number {
  const raw = cronConfig?.maxQueueAgeMs;
  return typeof raw === "number" && raw > 0 ? raw : DEFAULT_MAX_QUEUE_AGE_MS;
}

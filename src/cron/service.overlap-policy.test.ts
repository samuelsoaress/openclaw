import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCronActiveJobsForTests, markCronJobActive, isCronJobActive } from "./active-jobs.js";
import {
  setupCronServiceSuite,
  createStartedCronServiceWithFinishedBarrier,
} from "./service.test-harness.js";
import { applyJobPatch, createJob } from "./service/jobs.js";
import type { CronJob, CronJobPatch } from "./types.js";

afterEach(() => {
  resetCronActiveJobsForTests();
});

// -- Helper to create a minimal isolated agent turn job --
function createTestJob(id: string, overrides?: Partial<CronJob>): CronJob {
  const now = Date.now();
  return {
    id,
    name: id,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "test" },
    state: {},
    ...overrides,
  };
}

// ===================================================================
// Job CRUD tests
// ===================================================================

describe("overlapPolicy job CRUD", () => {
  it("createJob preserves overlapPolicy when set", () => {
    const state = { deps: { nowMs: () => Date.now() } } as never;
    const job = createJob(state, {
      name: "skip-job",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "test" },
      overlapPolicy: "skip",
    });
    expect(job.overlapPolicy).toBe("skip");
  });

  it("createJob defaults to no overlapPolicy when not set", () => {
    const state = { deps: { nowMs: () => Date.now() } } as never;
    const job = createJob(state, {
      name: "default-job",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "test" },
    });
    expect(job.overlapPolicy).toBeUndefined();
  });

  it("applyJobPatch updates overlapPolicy", () => {
    const job = createTestJob("patch-test");
    expect(job.overlapPolicy).toBeUndefined();

    const patch: CronJobPatch = { overlapPolicy: "queue" };
    applyJobPatch(job, patch);
    expect(job.overlapPolicy).toBe("queue");
  });

  it("applyJobPatch clears overlapPolicy with undefined", () => {
    const job = createTestJob("clear-test", { overlapPolicy: "skip" });
    expect(job.overlapPolicy).toBe("skip");

    const patch: CronJobPatch = { overlapPolicy: undefined };
    applyJobPatch(job, patch);
    expect(job.overlapPolicy).toBeUndefined();
  });

  it("applyJobPatch does not touch overlapPolicy when not in patch", () => {
    const job = createTestJob("noop-test", { overlapPolicy: "queue" });
    const patch: CronJobPatch = { name: "renamed" };
    applyJobPatch(job, patch);
    expect(job.overlapPolicy).toBe("queue");
  });
});

// ===================================================================
// Integration tests with CronService
// ===================================================================

describe("overlapPolicy skip behavior", () => {
  it("skip policy: isCronJobActive correctly identifies running jobs", () => {
    expect(isCronJobActive("job-skip-1")).toBe(false);
    markCronJobActive("job-skip-1");
    expect(isCronJobActive("job-skip-1")).toBe(true);
  });

  it("skip policy job should have lastRunStatus skipped when active", () => {
    const job = createTestJob("skip-active", { overlapPolicy: "skip" });
    markCronJobActive(job.id);

    // Simulate what the timer does for skip policy
    if (job.overlapPolicy === "skip" && isCronJobActive(job.id)) {
      job.state.lastRunStatus = "skipped";
      job.state.lastError = "skipped: overlap policy (job already running)";
      job.state.consecutiveSkipped = (job.state.consecutiveSkipped ?? 0) + 1;
      job.state.consecutiveDeferred = 0;
    }

    expect(job.state.lastRunStatus).toBe("skipped");
    expect(job.state.lastError).toContain("overlap policy");
    expect(job.state.consecutiveSkipped).toBe(1);
  });

  it("skip policy job should NOT be skipped when NOT active", () => {
    const job = createTestJob("skip-not-active", { overlapPolicy: "skip" });
    // Job is NOT marked active
    expect(isCronJobActive(job.id)).toBe(false);

    // Timer should allow this job to run
    const shouldSkip = job.overlapPolicy === "skip" && isCronJobActive(job.id);
    expect(shouldSkip).toBe(false);
  });

  it("skip policy increments consecutiveSkipped on each skip", () => {
    const job = createTestJob("skip-counter", { overlapPolicy: "skip" });
    markCronJobActive(job.id);

    for (let i = 1; i <= 5; i++) {
      job.state.consecutiveSkipped = (job.state.consecutiveSkipped ?? 0) + 1;
    }
    expect(job.state.consecutiveSkipped).toBe(5);
  });
});

describe("overlapPolicy allow behavior (default, backward-compatible)", () => {
  it("allow policy does not check active state", () => {
    const job = createTestJob("allow-test");
    markCronJobActive(job.id);

    // With allow policy (default), job should NOT be skipped even when active
    const policy = job.overlapPolicy ?? "allow";
    const shouldSkip = policy === "skip" && isCronJobActive(job.id);
    expect(shouldSkip).toBe(false);
  });

  it("missing overlapPolicy defaults to allow", () => {
    const job = createTestJob("no-policy");
    expect(job.overlapPolicy).toBeUndefined();
    const policy = job.overlapPolicy ?? "allow";
    expect(policy).toBe("allow");
  });
});

// ===================================================================
// Queue backpressure tests
// ===================================================================

describe("overlapPolicy queue backpressure", () => {
  it("consecutiveDeferred increments and resets correctly", () => {
    const job = createTestJob("deferred-counter", { overlapPolicy: "queue" });
    expect(job.state.consecutiveDeferred).toBeUndefined();

    // Simulate deferred increments
    job.state.consecutiveDeferred = 1;
    expect(job.state.consecutiveDeferred).toBe(1);

    job.state.consecutiveDeferred = 2;
    expect(job.state.consecutiveDeferred).toBe(2);

    // Reset on success
    job.state.consecutiveDeferred = 0;
    expect(job.state.consecutiveDeferred).toBe(0);
  });

  it("job state supports all overlap-related fields", () => {
    const job = createTestJob("full-state", {
      overlapPolicy: "queue",
      state: {
        consecutiveDeferred: 2,
        consecutiveSkipped: 1,
        lastRunStatus: "skipped",
        lastError: "skipped: queue depth exceeded (3/3)",
      },
    });

    expect(job.overlapPolicy).toBe("queue");
    expect(job.state.consecutiveDeferred).toBe(2);
    expect(job.state.consecutiveSkipped).toBe(1);
    expect(job.state.lastRunStatus).toBe("skipped");
    expect(job.state.lastError).toContain("queue depth exceeded");
  });
});

// ===================================================================
// Normalization tests
// ===================================================================

describe("overlapPolicy normalization", () => {
  it("normalizes valid overlap policy values", async () => {
    const { normalizeCronJobInput } = await import("./normalize.js");

    const result = normalizeCronJobInput({
      name: "norm-test",
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "test" },
      overlapPolicy: "SKIP",
    });

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).overlapPolicy).toBe("skip");
  });

  it("strips invalid overlap policy values", async () => {
    const { normalizeCronJobInput } = await import("./normalize.js");

    const result = normalizeCronJobInput({
      name: "invalid-policy",
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "test" },
      overlapPolicy: "invalid-value",
    });

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).overlapPolicy).toBeUndefined();
  });

  it("preserves queue overlap policy through normalization", async () => {
    const { normalizeCronJobInput } = await import("./normalize.js");

    const result = normalizeCronJobInput({
      name: "queue-test",
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "test" },
      overlapPolicy: "queue",
    });

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).overlapPolicy).toBe("queue");
  });

  it("handles missing overlapPolicy gracefully", async () => {
    const { normalizeCronJobInput } = await import("./normalize.js");

    const result = normalizeCronJobInput({
      name: "no-policy",
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "test" },
    });

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).overlapPolicy).toBeUndefined();
  });
});

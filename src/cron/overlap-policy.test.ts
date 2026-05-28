import { describe, expect, it } from "vitest";
import {
  resolveCronMaxQueueAgeMs,
  resolveCronMaxQueueDepth,
  resolveCronOverlapPolicy,
} from "./overlap-policy.js";

describe("resolveCronOverlapPolicy", () => {
  it("returns job-level policy when set", () => {
    expect(resolveCronOverlapPolicy({ overlapPolicy: "skip" }, {})).toBe("skip");
    expect(resolveCronOverlapPolicy({ overlapPolicy: "queue" }, {})).toBe("queue");
    expect(resolveCronOverlapPolicy({ overlapPolicy: "allow" }, {})).toBe("allow");
  });

  it("falls back to global config when job policy is absent", () => {
    expect(resolveCronOverlapPolicy({}, { overlapPolicy: "skip" })).toBe("skip");
    expect(resolveCronOverlapPolicy({}, { overlapPolicy: "queue" })).toBe("queue");
  });

  it("returns allow as default when neither job nor config set", () => {
    expect(resolveCronOverlapPolicy({}, {})).toBe("allow");
    expect(resolveCronOverlapPolicy({}, undefined)).toBe("allow");
    expect(resolveCronOverlapPolicy({})).toBe("allow");
  });

  it("job policy overrides global config", () => {
    expect(resolveCronOverlapPolicy({ overlapPolicy: "queue" }, { overlapPolicy: "skip" })).toBe(
      "queue",
    );
  });
});

describe("resolveCronMaxQueueDepth", () => {
  it("returns configured value", () => {
    expect(resolveCronMaxQueueDepth({ maxQueueDepth: 5 })).toBe(5);
  });

  it("returns default 3 when not configured", () => {
    expect(resolveCronMaxQueueDepth({})).toBe(3);
    expect(resolveCronMaxQueueDepth(undefined)).toBe(3);
  });

  it("ignores invalid values", () => {
    expect(resolveCronMaxQueueDepth({ maxQueueDepth: 0 })).toBe(3);
    expect(resolveCronMaxQueueDepth({ maxQueueDepth: -1 })).toBe(3);
  });
});

describe("resolveCronMaxQueueAgeMs", () => {
  it("returns configured value", () => {
    expect(resolveCronMaxQueueAgeMs({ maxQueueAgeMs: 60_000 })).toBe(60_000);
  });

  it("returns default 30min when not configured", () => {
    expect(resolveCronMaxQueueAgeMs({})).toBe(30 * 60 * 1000);
    expect(resolveCronMaxQueueAgeMs(undefined)).toBe(30 * 60 * 1000);
  });
});

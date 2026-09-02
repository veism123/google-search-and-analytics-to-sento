import { describe, expect, it } from "vitest";
import { completedIsoWeek, dailyWindow } from "../src/sources/windsor.js";
import { latestObservedAt } from "../src/pipeline.js";

describe("dailyWindow", () => {
  it("ends yesterday and spans lookbackDays complete days", () => {
    const w = dailyWindow(new Date("2026-09-01T19:00:00Z"), 7);
    expect(w.to).toBe("2026-08-31");
    expect(w.from).toBe("2026-08-25");
  });
});

describe("completedIsoWeek", () => {
  it("on a Tuesday returns Monday..Sunday of the previous week", () => {
    const w = completedIsoWeek(new Date("2026-09-01T19:00:00Z"));
    expect(w.from).toBe("2026-08-24");
    expect(w.to).toBe("2026-08-30");
    expect(w.observedAt).toBe("2026-08-31T06:00:00Z");
  });

  it("on a Sunday still uses the week ended the previous Sunday", () => {
    const w = completedIsoWeek(new Date("2026-09-06T10:00:00Z"));
    expect(w.to).toBe("2026-08-30");
  });

  it("on a Monday uses the week that just ended", () => {
    const w = completedIsoWeek(new Date("2026-08-31T10:00:00Z"));
    expect(w.from).toBe("2026-08-24");
    expect(w.to).toBe("2026-08-30");
  });
});

describe("latestObservedAt", () => {
  it("parses the observed_at from a metric read", () => {
    const text = "Current value: 11\n(raw: 11, observed_at: 2026-08-19T06:00:00+00:00)";
    expect(latestObservedAt(text)?.toISOString()).toBe("2026-08-19T06:00:00.000Z");
  });

  it("returns null when no observation exists", () => {
    expect(latestObservedAt("This metric holds no observations yet.")).toBeNull();
  });
});

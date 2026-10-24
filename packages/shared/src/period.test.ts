import { describe, expect, it } from "vitest";
import { resolvePeriod, tashkentToday } from "./period.js";

// 2026-10-24 is a Saturday. 20:30 UTC is already the 25th in Tashkent.
const lateEvening = new Date("2026-10-24T20:30:00Z");
const morning = new Date("2026-10-24T05:00:00Z");

describe("Tashkent periods", () => {
  it("uses the Tashkent date, not UTC", () => {
    expect(tashkentToday(morning)).toBe("2026-10-24");
    expect(tashkentToday(lateEvening)).toBe("2026-10-25");
  });
  it("resolves the fixed periods", () => {
    expect(resolvePeriod("today", {}, morning)).toEqual({ from: "2026-10-24", to: "2026-10-24" });
    expect(resolvePeriod("yesterday", {}, morning)).toEqual({ from: "2026-10-23", to: "2026-10-23" });
    expect(resolvePeriod("this_week", {}, morning)).toEqual({ from: "2026-10-19", to: "2026-10-24" });
    expect(resolvePeriod("this_month", {}, morning)).toEqual({ from: "2026-10-01", to: "2026-10-24" });
    expect(resolvePeriod("last_month", {}, morning)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("handles a Sunday and a year boundary", () => {
    expect(resolvePeriod("this_week", {}, new Date("2026-10-25T05:00:00Z")).from).toBe("2026-10-19");
    expect(resolvePeriod("last_month", {}, new Date("2027-01-10T05:00:00Z"))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });
});

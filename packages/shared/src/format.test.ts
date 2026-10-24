import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatUzs, normalizeUzPhone } from "./format.js";

const S = " ";

describe("formatUzs", () => {
  it("groups thousands with a non-breaking space", () => {
    expect(formatUzs("1250000")).toBe(`1${S}250${S}000 so'm`);
    expect(formatUzs("1250000.00")).toBe(`1${S}250${S}000 so'm`);
    expect(formatUzs("999")).toBe("999 so'm");
  });
  it("keeps significant fractions and the sign", () => {
    expect(formatUzs("-1500.50")).toBe(`-1${S}500,5 so'm`);
    expect(formatUzs("-0.00")).toBe("0 so'm");
  });
  it("can omit the currency", () => {
    expect(formatUzs("100000", { withCurrency: false })).toBe(`100${S}000`);
  });
  it("rejects garbage instead of printing NaN", () => {
    expect(() => formatUzs("12a")).toThrow();
  });
});

describe("dates in Tashkent time", () => {
  it("shifts UTC to UTC+5", () => {
    expect(formatDate("2026-10-23T20:00:00Z")).toBe("24.10.2026");
    expect(formatDateTime("2026-10-24T09:05:00Z")).toBe("24.10.2026 14:05");
  });
});

describe("normalizeUzPhone", () => {
  it("accepts common spellings", () => {
    expect(normalizeUzPhone("+998 90 123-45-67")).toBe("+998901234567");
    expect(normalizeUzPhone("90 123 45 67")).toBe("+998901234567");
  });
  it("rejects wrong lengths", () => {
    expect(normalizeUzPhone("12345")).toBeNull();
  });
});

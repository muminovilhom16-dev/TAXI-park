import { describe, expect, it } from "vitest";
import { addMoney, fromTiyin, parseMoneyInput, percentOf, toTiyin } from "./money.js";

describe("money", () => {
  it("round-trips decimal strings through tiyin", () => {
    expect(toTiyin("1250000.5")).toBe(125000050n);
    expect(fromTiyin(125000050n)).toBe("1250000.50");
    expect(fromTiyin(-5n)).toBe("-0.05");
    expect(() => toTiyin("1e5")).toThrow();
    expect(addMoney("0.10", "0.20")).toBe("0.30");
  });

  it("parses what people type", () => {
    expect(parseMoneyInput("1 250 000")).toBe("1250000.00");
    expect(parseMoneyInput("1250000,5 so'm")).toBe("1250000.50");
    expect(parseMoneyInput("350000.75")).toBe("350000.75");
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("12,345,678")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });

  it("computes the commission exactly with the chosen rounding", () => {
    expect(percentOf("1250000.00", "10.0000", "half_up", 0)).toBe("125000.00");
    expect(percentOf("123455.00", "10.0000", "half_up", 0)).toBe("12346.00"); // 12345.5 → up
    expect(percentOf("123455.00", "10.0000", "half_even", 0)).toBe("12346.00"); // 12345.5 → even 12346
    expect(percentOf("123445.00", "10.0000", "half_even", 0)).toBe("12344.00"); // 12344.5 → even 12344
    expect(percentOf("123459.00", "10.0000", "down", 0)).toBe("12345.00");
    expect(percentOf("100.05", "12.5000", "half_up", 2)).toBe("12.51"); // 12.50625
    expect(percentOf("0.00", "10.0000", "half_up", 0)).toBe("0.00");
    // 0.1 + 0.2 style float traps do not exist here.
    expect(percentOf("999999999999.99", "10.0000", "half_up", 2)).toBe("100000000000.00");
  });
});

// Exact money arithmetic. Amounts travel as decimal strings ("1250000.00") and
// are computed in integer tiyin (1/100 so'm) with BigInt, never with floats.

export type RoundingMode = "half_up" | "half_even" | "down";

const MONEY_RE = /^(-)?(\d{1,16})(?:\.(\d{1,2}))?$/;

/** "1250000.5" → 125000050n. Throws on anything that is not a plain decimal. */
export function toTiyin(amount: string): bigint {
  const m = MONEY_RE.exec(amount.trim());
  if (!m) throw new Error(`Noto'g'ri summa: ${amount}`);
  const [, sign, int = "0", frac = ""] = m;
  const v = BigInt(int) * 100n + BigInt(frac.padEnd(2, "0"));
  return sign ? -v : v;
}

/** 125000050n → "1250000.50" */
export function fromTiyin(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = `${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

export function addMoney(...amounts: string[]): string {
  return fromTiyin(amounts.reduce((s, a) => s + toTiyin(a), 0n));
}

/**
 * Accepts what people type: "1 250 000", "1250000,50", "350 000 so'm". A dot or
 * comma is a decimal separator only before 1-2 final digits, so "1,250,000" is
 * refused rather than guessed. Returns a canonical "1250000.50" or null.
 */
export function parseMoneyInput(input: string): string | null {
  const s = input.replace(/[\s ]/g, "").replace(/so'?m$/i, "");
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const [, int = "", frac = ""] = m;
  if (int.length > 16) return null;
  return fromTiyin(BigInt(int) * 100n + BigInt(frac.padEnd(2, "0") || "0"));
}

function divRound(num: bigint, den: bigint, mode: RoundingMode): bigint {
  // num >= 0, den > 0 for every caller here.
  const q = num / den;
  const r = num % den;
  if (r === 0n || mode === "down") return q;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return mode === "half_up" ? q + 1n : q % 2n === 0n ? q : q + 1n;
}

/**
 * percentOf("1250000.00", "10.0000", "half_up", 0) → "125000.00".
 * `scale` is the number of decimals kept in so'm (0 = whole so'm).
 */
export function percentOf(amount: string, ratePercent: string, mode: RoundingMode, scale: 0 | 1 | 2): string {
  const base = toTiyin(amount);
  if (base < 0n) throw new Error("Manfiy summadan foiz olinmaydi");
  const rm = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(ratePercent.trim());
  if (!rm) throw new Error(`Noto'g'ri foiz: ${ratePercent}`);
  const rate = BigInt(rm[1]!) * 10_000n + BigInt((rm[2] ?? "").padEnd(4, "0"));
  const unit = 10n ** BigInt(2 - scale); // tiyin per kept unit
  // base tiyin × rate/1 000 000 (rate has 4 decimals and is a percent).
  const units = divRound(base * rate, 1_000_000n * unit, mode);
  return fromTiyin(units * unit);
}

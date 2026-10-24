import { z } from "zod";

// Reporting periods are Tashkent calendar days (UTC+5, no DST).
export const PERIODS = ["today", "yesterday", "this_week", "this_month", "last_month", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  today: "Bugun",
  yesterday: "Kecha",
  this_week: "Joriy hafta",
  this_month: "Joriy oy",
  last_month: "Oldingi oy",
  custom: "Sana oralig'i",
};

export const periodQuerySchema = z
  .object({
    period: z.enum(PERIODS).default("this_month"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.period !== "custom" || (v.from && v.to && v.from <= v.to), {
    message: "Sana oralig'ini to'g'ri kiriting",
    path: ["from"],
  });

const DAY = 86_400_000;
const OFFSET = 5 * 3_600_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's date in Tashkent as YYYY-MM-DD. */
export function tashkentToday(now: Date = new Date()): string {
  return isoDay(now.getTime() + OFFSET);
}

/**
 * Inclusive range of Tashkent dates for a period. Weeks start on Monday.
 */
export function resolvePeriod(
  period: Period,
  custom: { from?: string | undefined; to?: string | undefined } = {},
  now: Date = new Date(),
): { from: string; to: string } {
  const today = tashkentToday(now);
  const t = Date.parse(`${today}T00:00:00Z`);
  const d = new Date(t);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: isoDay(t - DAY), to: isoDay(t - DAY) };
    case "this_week": {
      const sinceMonday = (d.getUTCDay() + 6) % 7;
      return { from: isoDay(t - sinceMonday * DAY), to: today };
    }
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const firstThis = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const lastPrev = firstThis - DAY;
      return { from: `${isoDay(lastPrev).slice(0, 7)}-01`, to: isoDay(lastPrev) };
    }
    case "custom":
      if (!custom.from || !custom.to) throw new Error("custom period needs from and to");
      return { from: custom.from, to: custom.to };
  }
}

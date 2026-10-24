// Display formatting for Uzbek users. Pure string work: no Intl locale data is
// assumed, because "uz" support differs between browsers and Node builds.

const NBSP = " ";

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Formats a decimal string or number as "1 250 000 so'm". */
export function formatUzs(value: string | number, opts: { withCurrency?: boolean } = {}): string {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`Noto'g'ri summa: ${value}`);
  const [, sign = "", int = "0", frac = ""] = match;
  const fracTrimmed = frac.replace(/0+$/, "");
  const body = groupThousands(int.replace(/^0+(?=\d)/, "")) + (fracTrimmed ? `,${fracTrimmed}` : "");
  const signed = sign && /[1-9]/.test(int + frac) ? `-${body}` : body;
  return opts.withCurrency === false ? signed : `${signed} so'm`;
}

const TASHKENT_OFFSET_MINUTES = 5 * 60; // Asia/Tashkent is UTC+5 with no DST.

function tashkentParts(date: Date) {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: pad(shifted.getUTCDate()),
    month: pad(shifted.getUTCMonth() + 1),
    year: shifted.getUTCFullYear(),
    hours: pad(shifted.getUTCHours()),
    minutes: pad(shifted.getUTCMinutes()),
  };
}

/** "24.10.2026" in Tashkent time. */
export function formatDate(value: Date | string): string {
  const p = tashkentParts(new Date(value));
  return `${p.day}.${p.month}.${p.year}`;
}

/** "24.10.2026 14:05" in Tashkent time. */
export function formatDateTime(value: Date | string): string {
  const p = tashkentParts(new Date(value));
  return `${p.day}.${p.month}.${p.year} ${p.hours}:${p.minutes}`;
}

/** Normalizes Uzbek phone numbers to +998XXXXXXXXX, or returns null. */
export function normalizeUzPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return null;
}

/** A calendar date "2026-10-24" as "24.10.2026", with no timezone shift. */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

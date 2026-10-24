import type { FastifyReply } from "fastify";

// CSV for Excel as people in Uzbekistan run it: ";" separated, decimal comma,
// UTF-8 with a BOM so Cyrillic and ʻ survive. Text that starts like a formula
// is prefixed with ' so a crafted driver name cannot run in a spreadsheet.

export type Cell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(,\d+)?$/;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A NUMERIC string such as "-35000.50" as a number Excel reads: -35000,50 */
export function moneyCell(v: string): string {
  return v.replace(".", ",");
}

export function sendCsv(reply: FastifyReply, fileName: string, header: string[], rows: Cell[][]) {
  const body = [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${fileName}"`)
    .header("cache-control", "no-store")
    .send(`﻿${body}\r\n`);
}

/** One export is one spreadsheet; beyond this, narrow the period. */
export const EXPORT_LIMIT = 50_000;

/** "+998901112233" → "998 90 111 22 33": stays text in Excel without a leading "+". */
export function phoneCell(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return d.length === 12 ? `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : d;
}

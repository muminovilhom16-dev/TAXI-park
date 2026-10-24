import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  addMoney,
  normalizeUzPhone,
  parseMoneyInput,
  tashkentToday,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowStatus,
} from "@taxi/shared";
import type { DbOrTx } from "../db/client.js";
import { aggregatorDriverAccounts, dailyEarnings, drivers } from "../db/schema/index.js";
import { parseCsv } from "../lib/csv.js";
import { AppError } from "../lib/errors.js";
import { commissionFor, findPolicy } from "./finance.js";

// Our own template, one row per driver per day. Real aggregator report formats
// get their own adapters once a sample file exists.
const DATE_HEADERS = ["sana", "date", "kun", "дата"];
const AMOUNT_HEADERS = ["summa", "tushum", "amount", "сумма"];
const EXTERNAL_ID_HEADERS = ["agregator_id", "haydovchi_id", "external_id", "driver_id", "id"];
const PHONE_HEADERS = ["telefon", "phone", "tel", "телефон"];

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s'`ʻ’-]+/g, "_");

export function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** "2026-10-24" or "24.10.2026" (also with "/" or "-"), validated as a real date. */
export function parseDay(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

type ValidRow = { rowNumber: number; driverId: string; workDate: string; grossAmount: string };

export async function buildImportPreview(
  db: DbOrTx,
  aggregatorId: string,
  content: string,
): Promise<{ preview: ImportPreview; valid: ValidRow[] }> {
  const table = parseCsv(content);
  if (table.length < 2) throw new AppError(400, "empty_file", "Faylda sarlavha va kamida bitta qator bo'lsin");
  if (table.length > 5001) throw new AppError(400, "too_many_rows", "Bir faylda 5000 tadan ko'p qator bo'lmasin");
  const header = table[0]!.map(norm);
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const dateCol = find(DATE_HEADERS);
  const amountCol = find(AMOUNT_HEADERS);
  const extCol = find(EXTERNAL_ID_HEADERS);
  const phoneCol = find(PHONE_HEADERS);
  const driverCol = extCol >= 0 ? extCol : phoneCol;
  const missing = [
    dateCol < 0 && "sana",
    amountCol < 0 && "summa",
    driverCol < 0 && "agregator_id yoki telefon",
  ].filter(Boolean);
  if (missing.length) {
    throw new AppError(400, "missing_columns", `Faylda ustun topilmadi: ${missing.join(", ")}`, {
      found: table[0],
    });
  }
  const driverKind = extCol >= 0 ? ("external_id" as const) : ("phone" as const);
  const today = tashkentToday();

  const parsed = table.slice(1).map((cells, i) => {
    const identifier = (cells[driverCol] ?? "").trim();
    const workDate = parseDay(cells[dateCol] ?? "");
    const grossAmount = parseMoneyInput(cells[amountCol] ?? "");
    const errors: string[] = [];
    if (!identifier) errors.push("Haydovchi ko'rsatilmagan");
    if (!workDate) errors.push("Sana noto'g'ri");
    else if (workDate > today) errors.push("Sana kelajakda");
    if (grossAmount === null) errors.push("Summa noto'g'ri");
    return { rowNumber: i + 2, identifier, workDate, grossAmount, errors };
  });

  // Resolve drivers in two queries rather than one per row.
  const ids = [...new Set(parsed.map((r) => r.identifier).filter(Boolean))];
  const byKey = new Map<string, { id: string; fullName: string }>();
  if (ids.length && driverKind === "external_id") {
    const rows = await db
      .select({
        key: aggregatorDriverAccounts.externalDriverId,
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
      })
      .from(aggregatorDriverAccounts)
      .innerJoin(drivers, eq(drivers.id, aggregatorDriverAccounts.driverId))
      .where(
        and(
          eq(aggregatorDriverAccounts.aggregatorId, aggregatorId),
          inArray(aggregatorDriverAccounts.externalDriverId, ids),
          isNull(aggregatorDriverAccounts.unlinkedAt),
          isNull(drivers.archivedAt),
        ),
      );
    for (const r of rows) byKey.set(r.key, { id: r.id, fullName: `${r.lastName} ${r.firstName}` });
  } else if (ids.length) {
    const phones = [...new Set(ids.map((p) => normalizeUzPhone(p)).filter((p): p is string => !!p))];
    if (phones.length) {
      const rows = await db
        .select({ phone: drivers.phone, id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
        .from(drivers)
        .where(and(inArray(drivers.phone, phones), isNull(drivers.archivedAt)));
      for (const r of rows) if (r.phone) byKey.set(r.phone, { id: r.id, fullName: `${r.lastName} ${r.firstName}` });
    }
  }
  const resolve = (identifier: string) =>
    byKey.get(driverKind === "phone" ? (normalizeUzPhone(identifier) ?? "") : identifier) ?? null;

  // Rows already entered for this aggregator are skipped, not doubled.
  const resolvedIds = [...new Set(parsed.map((r) => resolve(r.identifier)?.id).filter((x): x is string => !!x))];
  const existing = new Set<string>();
  if (resolvedIds.length) {
    const rows = await db
      .select({ driverId: dailyEarnings.driverId, workDate: dailyEarnings.workDate })
      .from(dailyEarnings)
      .where(
        and(
          eq(dailyEarnings.aggregatorId, aggregatorId),
          eq(dailyEarnings.status, "active"),
          inArray(dailyEarnings.driverId, resolvedIds),
        ),
      );
    for (const r of rows) existing.add(`${r.driverId}|${r.workDate}`);
  }

  // A driver and day listed twice is ambiguous: neither row is taken.
  const inFile = new Map<string, number>();
  for (const r of parsed) {
    const d = r.errors.length ? null : resolve(r.identifier);
    if (d) inFile.set(`${d.id}|${r.workDate}`, (inFile.get(`${d.id}|${r.workDate}`) ?? 0) + 1);
  }

  const policies = new Map<string, Awaited<ReturnType<typeof findPolicy>>>();
  const rows: ImportPreviewRow[] = [];
  const valid: ValidRow[] = [];
  const counts: Record<ImportRowStatus, number> = { valid: 0, invalid: 0, unknown_driver: 0, duplicate: 0 };
  let gross = "0.00";
  let commission = "0.00";

  for (const r of parsed) {
    const driver = r.identifier ? resolve(r.identifier) : null;
    let status: ImportRowStatus = "valid";
    let commissionAmount: string | null = null;
    const errors = [...r.errors];
    if (errors.length) status = "invalid";
    else if (!driver) {
      status = "unknown_driver";
      errors.push(driverKind === "phone" ? "Bu telefon bilan haydovchi yo'q" : "Bu ID hech bir haydovchiga bog'lanmagan");
    } else {
      const key = `${driver.id}|${r.workDate}`;
      if ((inFile.get(key) ?? 0) > 1) {
        status = "invalid";
        errors.push("Shu haydovchi va kun faylda bir necha marta");
      } else if (existing.has(key)) {
        status = "duplicate";
        errors.push("Bu kun uchun tushum allaqachon kiritilgan");
      } else {
        if (!policies.has(r.workDate!)) policies.set(r.workDate!, await findPolicy(db, aggregatorId, r.workDate!));
        const policy = policies.get(r.workDate!);
        if (!policy) {
          status = "invalid";
          errors.push("Bu sana uchun komissiya stavkasi yo'q");
        } else {
          commissionAmount = commissionFor(r.grossAmount!, policy);
        }
      }
    }
    counts[status]++;
    if (status === "valid") {
      valid.push({ rowNumber: r.rowNumber, driverId: driver!.id, workDate: r.workDate!, grossAmount: r.grossAmount! });
      gross = addMoney(gross, r.grossAmount!);
      commission = addMoney(commission, commissionAmount!);
    }
    rows.push({
      rowNumber: r.rowNumber,
      status,
      driver,
      identifier: r.identifier,
      workDate: r.workDate,
      grossAmount: r.grossAmount,
      commissionAmount,
      errors,
    });
  }

  return {
    preview: {
      sha256: sha256(content),
      columns: {
        date: table[0]![dateCol]!,
        amount: table[0]![amountCol]!,
        driver: table[0]![driverCol]!,
        driverKind,
      },
      rows,
      counts,
      totals: { grossAmount: gross, commissionAmount: commission },
    },
    valid,
  };
}

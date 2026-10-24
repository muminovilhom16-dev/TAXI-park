import { z } from "zod";
import { parseMoneyInput } from "./money.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD ko'rinishida bo'lsin");

/** Money typed by a person ("1 250 000") → canonical "1250000.00". */
export const moneyInput = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const parsed = parseMoneyInput(String(v));
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Summani raqam bilan kiriting, masalan 350 000" });
      return z.NEVER;
    }
    return parsed;
  });
const positiveMoney = moneyInput.refine((v) => v !== "0.00", "Summa noldan katta bo'lsin");

// ---- Settings -------------------------------------------------------------

export const SUBSCRIPTION_CHARGE_MODES = ["every_active_day", "worked_days_only"] as const;
export type SubscriptionChargeMode = (typeof SUBSCRIPTION_CHARGE_MODES)[number];
export const SUBSCRIPTION_CHARGE_MODE_LABELS: Record<SubscriptionChargeMode, string> = {
  every_active_day: "Holati \"Faol\" bo'lgan har kuni",
  worked_days_only: "Faqat tushum kiritilgan kunlari",
};

export const COMMISSION_COLLECTION_MODES = ["withheld", "driver_pays"] as const;
export type CommissionCollectionMode = (typeof COMMISSION_COLLECTION_MODES)[number];
export const COMMISSION_COLLECTION_LABELS: Record<CommissionCollectionMode, string> = {
  withheld: "Agregator o'zi ushlab qoladi (qarz bo'lmaydi)",
  driver_pays: "Haydovchi parkka to'laydi (to'lanmasa qarzga yoziladi)",
};

export type FinanceSettings = {
  subscriptionDailyAmount: string | null;
  subscriptionChargeMode: SubscriptionChargeMode | null;
  commissionCollection: CommissionCollectionMode;
  /** Subscription accrual runs only when both the amount and the mode are set. */
  subscriptionEnabled: boolean;
};

export const financeSettingsSchema = z.object({
  subscriptionDailyAmount: positiveMoney.nullable(),
  subscriptionChargeMode: z.enum(SUBSCRIPTION_CHARGE_MODES).nullable(),
  commissionCollection: z.enum(COMMISSION_COLLECTION_MODES),
});

export const commissionPolicyCreateSchema = z.object({
  aggregatorId: z.string().uuid(),
  ratePercent: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && Number(v) <= 100, "Foiz 0 dan 100 gacha bo'lsin"),
  validFrom: isoDate,
});

export type CommissionPolicyRow = {
  id: string;
  aggregatorId: string;
  aggregator: string;
  name: string;
  ratePercent: string;
  validFrom: string;
  validTo: string | null;
  approvedAt: string | null;
};

// ---- Daily earnings --------------------------------------------------------

export const earningCreateSchema = z.object({
  driverId: z.string().uuid(),
  aggregatorId: z.string().uuid(),
  workDate: isoDate,
  grossAmount: moneyInput,
  note: z.string().trim().max(500).nullish(),
});

export const voidSchema = z.object({
  reason: z.string().trim().min(3, "Sababni yozing").max(500),
});

export const earningListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  driverId: z.string().uuid().optional(),
  aggregatorId: z.string().uuid().optional(),
  status: z.enum(["active", "voided", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type EarningRow = {
  id: string;
  workDate: string;
  driver: { id: string; fullName: string };
  aggregator: { id: string; name: string };
  grossAmount: string;
  commissionRatePercent: string;
  commissionAmount: string;
  source: "manual" | "csv";
  status: "active" | "voided";
  note: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: string;
};

export type EarningTotals = { count: number; grossAmount: string; commissionAmount: string };

export const earningImportSchema = z.object({
  aggregatorId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200),
  // CSV text; the browser reads the file, the server parses and validates it.
  content: z.string().min(1, "Fayl bo'sh").max(2_000_000, "Fayl 2 MB dan katta"),
});

export type ImportRowStatus = "valid" | "invalid" | "unknown_driver" | "duplicate";
export type ImportPreviewRow = {
  rowNumber: number;
  status: ImportRowStatus;
  driver: { id: string; fullName: string } | null;
  identifier: string;
  workDate: string | null;
  grossAmount: string | null;
  commissionAmount: string | null;
  errors: string[];
};
export type ImportPreview = {
  sha256: string;
  columns: { date: string; amount: string; driver: string; driverKind: "external_id" | "phone" };
  rows: ImportPreviewRow[];
  counts: Record<ImportRowStatus, number>;
  totals: { grossAmount: string; commissionAmount: string };
};

// ---- Charges, payments, debts ------------------------------------------------

export const CHARGE_KIND_LABELS = { subscription: "Kunlik obuna", commission: "Komissiya", other: "Boshqa" } as const;
export type ChargeKind = keyof typeof CHARGE_KIND_LABELS;

export const accrueSchema = z.object({ date: isoDate });

export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "other"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Naqd",
  card: "Karta",
  bank_transfer: "Bank o'tkazmasi",
  other: "Boshqa",
};

export const paymentCreateSchema = z.object({
  driverId: z.string().uuid(),
  amount: positiveMoney,
  paymentMethod: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(500).nullish(),
  // Generated by the form when it opens; a double click or retry is a no-op.
  idempotencyKey: z.string().min(8).max(100),
});

export const paymentListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).default("all"),
  driverId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type PaymentRow = {
  id: string;
  type: "driver_other_payment_in" | "adjustment";
  direction: "in" | "out";
  amount: string;
  paymentMethod: string;
  occurredAt: string;
  driver: { id: string; fullName: string } | null;
  approvalStatus: "pending" | "approved" | "rejected";
  createdBy: { id: string; fullName: string };
  approvedBy: string | null;
  reversesTransactionId: string | null;
  reversed: boolean;
  note: string | null;
};

export type DebtRow = {
  driver: { id: string; fullName: string; phone: string; crmStatus: string; archived: boolean };
  charged: string;
  paid: string;
  balance: string;
  pendingPayments: string;
  oldestUnpaidDate: string | null;
};

export type LedgerEntry = {
  id: string;
  date: string;
  kind: "charge" | "payment" | "earning";
  label: string;
  amount: string;
  status: string;
  note: string | null;
};

export type DriverFinance = {
  balance: string;
  charged: string;
  paid: string;
  pendingPayments: string;
  ledger: LedgerEntry[];
};

export type FinanceStats = {
  period: { from: string; to: string };
  grossEarnings: string;
  commission: string;
  subscriptionsCharged: string;
  paymentsReceived: string;
  outstandingDebt: string;
  debtors: number;
  pendingPayments: number;
  missingEarningsYesterday: number;
};

import { z } from "zod";
import { normalizeUzPhone } from "./format.js";

export const CRM_STATUSES = ["new", "documents_review", "active", "suspended", "terminated"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  new: "Yangi",
  documents_review: "Hujjatlar tekshirilmoqda",
  active: "Faol",
  suspended: "Vaqtincha to'xtatilgan",
  terminated: "Faoliyatni tugatgan",
};

// Leaving the park or being suspended always needs a written reason.
export const STATUSES_REQUIRING_REASON: readonly CrmStatus[] = ["suspended", "terminated"];

export const LICENSE_STATUSES = ["unknown", "valid", "expired", "missing"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  unknown: "Noma'lum",
  valid: "Amalda",
  expired: "Muddati o'tgan",
  missing: "Yo'q",
};

export const MONEY_FLOW_MODELS = ["unconfirmed", "park_collects", "driver_collects", "mixed"] as const;
export type MoneyFlowModel = (typeof MONEY_FLOW_MODELS)[number];
export const MONEY_FLOW_LABELS: Record<MoneyFlowModel, string> = {
  unconfirmed: "Tasdiqlanmagan",
  park_collects: "Agregator → park → haydovchi",
  driver_collects: "Agregator → haydovchi → park",
  mixed: "Aralash",
};

export const INTEGRATION_STATUSES = ["file_import", "api", "disabled"] as const;
export const INTEGRATION_LABELS: Record<(typeof INTEGRATION_STATUSES)[number], string> = {
  file_import: "Fayl importi",
  api: "API",
  disabled: "O'chirilgan",
};

/** Uppercase, no spaces or dashes: "01 A 123 BC" → "01A123BC". */
export function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

const trimmedOrNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD ko'rinishida bo'lsin");

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeUzPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Telefon raqami +998XXXXXXXXX ko'rinishida bo'lsin" });
      return z.NEVER;
    }
    return n;
  });

export const plateSchema = z
  .string()
  .transform(normalizePlate)
  .refine((v) => /^\d{2}[A-Z0-9]{6}$/.test(v), "Davlat raqami noto'g'ri, masalan: 01 A 123 BC");

const driverFields = {
  firstName: z.string().trim().min(1, "Ism kiritilmagan").max(80),
  lastName: z.string().trim().min(1, "Familiya kiritilmagan").max(80),
  phone: phoneSchema,
  extraContact: trimmedOrNull(120),
  passportNumber: trimmedOrNull(32),
  licenseNumber: trimmedOrNull(32),
  licenseStatus: z.enum(LICENSE_STATUSES),
  licenseExpiresOn: isoDate.nullish().transform((v) => v ?? null),
  registeredOn: isoDate,
  managerId: z.string().uuid().nullish().transform((v) => v ?? null),
  note: trimmedOrNull(2000),
};

export const createDriverSchema = z.object({
  ...driverFields,
  licenseStatus: driverFields.licenseStatus.default("unknown"),
  registeredOn: driverFields.registeredOn.optional(),
});
export type CreateDriverInput = z.input<typeof createDriverSchema>;

export const updateDriverSchema = z
  .object(driverFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Kamida bitta maydon kerak");
export type UpdateDriverInput = z.input<typeof updateDriverSchema>;

export const changeStatusSchema = z
  .object({ status: z.enum(CRM_STATUSES), reason: trimmedOrNull(500) })
  .refine((v) => !STATUSES_REQUIRING_REASON.includes(v.status) || !!v.reason, {
    message: "Bu holat uchun sabab yozilishi kerak",
    path: ["reason"],
  });

export const archiveSchema = z.object({ reason: z.string().trim().min(3, "Sababni yozing").max(500) });

export const DRIVER_SORTS = ["name", "registeredOn", "createdAt", "status"] as const;

export const driverListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.enum(CRM_STATUSES).optional(),
  // A user id, or "none" for drivers without a manager.
  manager: z.union([z.literal("none"), z.string().uuid()]).optional(),
  aggregatorId: z.string().uuid().optional(),
  licenseStatus: z.enum(LICENSE_STATUSES).optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
  sort: z.enum(DRIVER_SORTS).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const linkAccountSchema = z.object({
  aggregatorId: z.string().uuid(),
  externalDriverId: z.string().trim().min(1, "ID kiritilmagan").max(100),
  externalStatus: trimmedOrNull(60),
});

export const aggregatorSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,32}$/, "Kod: lotin harflari, raqamlar, '_' yoki '-'"),
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().default(true),
  moneyFlowModel: z.enum(MONEY_FLOW_MODELS).default("unconfirmed"),
  integrationStatus: z.enum(INTEGRATION_STATUSES).default("file_import"),
  note: trimmedOrNull(1000),
});
export const updateAggregatorSchema = aggregatorSchema
  .omit({ code: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Kamida bitta maydon kerak");

export const vehicleSchema = z.object({
  plateNumber: plateSchema,
  make: trimmedOrNull(60),
  model: z.string().trim().min(1, "Model kiritilmagan").max(60),
  year: z.coerce
    .number()
    .int()
    .min(1980)
    .max(new Date().getFullYear() + 1)
    .nullish()
    .transform((v) => v ?? null),
  color: trimmedOrNull(40),
  note: trimmedOrNull(1000),
});
export const updateVehicleSchema = vehicleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Kamida bitta maydon kerak");

export const assignVehicleSchema = z.object({ vehicleId: z.string().uuid() });

// ---- Response shapes ----

export type PersonRef = { id: string; fullName: string };

export type DriverAccount = {
  id: string;
  aggregator: { id: string; code: string; name: string };
  externalDriverId: string;
  externalStatus: string | null;
  linkedAt: string;
  unlinkedAt: string | null;
};

export type VehicleRef = { id: string; plateNumber: string; make: string | null; model: string };

export type DriverListItem = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  crmStatus: CrmStatus;
  licenseStatus: LicenseStatus;
  registeredOn: string;
  manager: PersonRef | null;
  vehicle: VehicleRef | null;
  accounts: { aggregatorName: string; externalDriverId: string }[];
  archivedAt: string | null;
};

export type DriverDetail = DriverListItem & {
  extraContact: string | null;
  // null with piiHidden=true when the viewer lacks drivers.pii.read.
  passportNumber: string | null;
  piiHidden: boolean;
  licenseNumber: string | null;
  licenseExpiresOn: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: {
    id: string;
    fromStatus: CrmStatus | null;
    toStatus: CrmStatus;
    reason: string | null;
    changedBy: PersonRef | null;
    createdAt: string;
  }[];
  vehicleHistory: { id: string; vehicle: VehicleRef; assignedFrom: string; assignedTo: string | null }[];
  allAccounts: DriverAccount[];
};

export type DuplicateMatch = {
  field: "phone" | "externalDriverId";
  driver: { id: string; fullName: string; archived: boolean };
};

export type AggregatorRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  moneyFlowModel: MoneyFlowModel;
  integrationStatus: (typeof INTEGRATION_STATUSES)[number];
  note: string | null;
  linkedDrivers: number;
};

export type VehicleRow = VehicleRef & {
  year: number | null;
  color: string | null;
  note: string | null;
  archivedAt: string | null;
  driver: { id: string; fullName: string } | null;
};

export type CrmStats = {
  period: { from: string; to: string };
  totalDrivers: number;
  activeDrivers: number;
  newDrivers: number;
  inactiveDrivers: number;
  withoutManager: number;
  withoutAggregatorAccount: number;
};

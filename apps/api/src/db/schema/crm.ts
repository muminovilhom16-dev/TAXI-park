import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { id, timestamps } from "./columns.js";
import { crmStatus, integrationStatus, licenseStatus, moneyFlowModel } from "./enums.js";

export const drivers = pgTable(
  "drivers",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // Stored normalized as +998XXXXXXXXX.
    phone: text("phone").notNull(),
    extraContact: text("extra_contact"),
    // Personal data: only read by roles with drivers.pii.read.
    passportNumber: text("passport_number"),
    licenseNumber: text("license_number"),
    licenseStatus: licenseStatus("license_status").notNull().default("unknown"),
    licenseExpiresOn: date("license_expires_on"),
    registeredOn: date("registered_on").notNull().default(sql`(now() at time zone 'Asia/Tashkent')::date`),
    managerId: uuid("manager_id").references(() => users.id),
    crmStatus: crmStatus("crm_status").notNull().default("new"),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    // A phone may be reused only after the old record is archived.
    uniqueIndex("drivers_phone_active_uq").on(t.phone).where(sql`${t.archivedAt} is null`),
    index("drivers_manager_idx").on(t.managerId),
    index("drivers_status_idx").on(t.crmStatus),
    index("drivers_name_idx").on(t.lastName, t.firstName),
  ],
);

export const driverStatusHistory = pgTable(
  "driver_status_history",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id),
    fromStatus: crmStatus("from_status"),
    toStatus: crmStatus("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("driver_status_history_driver_idx").on(t.driverId, t.createdAt)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    // Stored uppercase without spaces, e.g. 01A123BC.
    plateNumber: text("plate_number").notNull(),
    make: text("make"),
    model: text("model").notNull(),
    year: integer("year"),
    color: text("color"),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("vehicles_plate_active_uq").on(t.plateNumber).where(sql`${t.archivedAt} is null`)],
);

// Overlap of assignments for the same vehicle is blocked by an exclusion
// constraint in the custom migration (drizzle cannot express EXCLUDE).
export const driverVehicleAssignments = pgTable(
  "driver_vehicle_assignments",
  {
    id: id(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    assignedFrom: timestamp("assigned_from", { withTimezone: true }).notNull().defaultNow(),
    assignedTo: timestamp("assigned_to", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dva_driver_idx").on(t.driverId), index("dva_vehicle_idx").on(t.vehicleId)],
);

export const aggregators = pgTable("aggregators", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // Stays unconfirmed until the owner confirms how money actually moves.
  moneyFlowModel: moneyFlowModel("money_flow_model").notNull().default("unconfirmed"),
  integrationStatus: integrationStatus("integration_status").notNull().default("file_import"),
  importSettings: jsonb("import_settings").notNull().default({}),
  note: text("note"),
  ...timestamps(),
});

export const aggregatorDriverAccounts = pgTable(
  "aggregator_driver_accounts",
  {
    id: id(),
    aggregatorId: uuid("aggregator_id")
      .notNull()
      .references(() => aggregators.id),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id),
    externalDriverId: text("external_driver_id").notNull(),
    // The aggregator's own status, kept apart from our CRM status.
    externalStatus: text("external_status"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ada_external_uq").on(t.aggregatorId, t.externalDriverId),
    index("ada_driver_idx").on(t.driverId),
  ],
);

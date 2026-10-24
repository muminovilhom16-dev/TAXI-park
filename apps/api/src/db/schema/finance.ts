import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
import { id, money, percent, timestamps } from "./columns.js";
import { aggregators, drivers } from "./crm.js";
import {
  approvalStatus,
  commissionBaseType,
  importStatus,
  moneyFlowModel,
  paymentMethod,
  periodType,
  roundingMode,
  settlementStatus,
  statementLineStatus,
  transactionDirection,
  transactionType,
} from "./enums.js";

// Overlapping validity ranges per aggregator are blocked in the custom migration.
export const commissionPolicies = pgTable(
  "commission_policies",
  {
    id: id(),
    aggregatorId: uuid("aggregator_id")
      .notNull()
      .references(() => aggregators.id),
    name: text("name").notNull(),
    ratePercent: percent("rate_percent").notNull(),
    baseType: commissionBaseType("base_type").notNull(),
    // Which statement components are added or subtracted; explicit, never implied.
    baseRules: jsonb("base_rules").notNull().default({}),
    roundingMode: roundingMode("rounding_mode").notNull().default("half_up"),
    roundingScale: integer("rounding_scale").notNull().default(0),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    check("commission_rate_range", sql`${t.ratePercent} >= 0 and ${t.ratePercent} <= 100`),
    check("commission_rounding_scale", sql`${t.roundingScale} between 0 and 2`),
    check("commission_valid_range", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

export const settlementPeriods = pgTable(
  "settlement_periods",
  {
    id: id(),
    aggregatorId: uuid("aggregator_id")
      .notNull()
      .references(() => aggregators.id),
    periodType: periodType("period_type").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: settlementStatus("status").notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    check("period_range", sql`${t.endsOn} >= ${t.startsOn}`),
    uniqueIndex("settlement_periods_uq").on(t.aggregatorId, t.periodType, t.startsOn),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: id(),
    aggregatorId: uuid("aggregator_id")
      .notNull()
      .references(() => aggregators.id),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type"),
    status: importStatus("status").notNull().default("uploaded"),
    columnMapping: jsonb("column_mapping"),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsValid: integer("rows_valid").notNull().default(0),
    rowsInvalid: integer("rows_invalid").notNull().default(0),
    rowsDuplicate: integer("rows_duplicate").notNull().default(0),
    rowsUnknownDriver: integer("rows_unknown_driver").notNull().default(0),
    errorSummary: jsonb("error_summary"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    committedBy: uuid("committed_by").references(() => users.id),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    ...timestamps(),
  },
  // The exact same file cannot be imported twice for one aggregator.
  (t) => [uniqueIndex("import_batches_file_uq").on(t.aggregatorId, t.fileSha256)],
);

// Amount columns are provisional until a real aggregator report is analysed;
// the full source row is always kept in `raw`.
export const aggregatorStatementLines = pgTable(
  "aggregator_statement_lines",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    importBatchId: uuid("import_batch_id")
      .notNull()
      .references(() => importBatches.id),
    aggregatorId: uuid("aggregator_id")
      .notNull()
      .references(() => aggregators.id),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    lineFingerprint: text("line_fingerprint").notNull(),
    externalLineId: text("external_line_id"),
    externalDriverId: text("external_driver_id"),
    driverId: uuid("driver_id").references(() => drivers.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    grossAmount: money("gross_amount"),
    aggregatorCommissionAmount: money("aggregator_commission_amount"),
    bonusAmount: money("bonus_amount"),
    penaltyAmount: money("penalty_amount"),
    refundAmount: money("refund_amount"),
    cashAmount: money("cash_amount"),
    netAmount: money("net_amount"),
    status: statementLineStatus("status").notNull(),
    validationErrors: jsonb("validation_errors"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Re-importing the same lines (even from a different file) cannot create
    // a second financial line; rejected rows are stored but do not count.
    uniqueIndex("statement_lines_fingerprint_uq")
      .on(t.aggregatorId, t.lineFingerprint)
      .where(sql`${t.status} in ('valid', 'unknown_driver')`),
    index("statement_lines_batch_idx").on(t.importBatchId),
    index("statement_lines_driver_idx").on(t.driverId, t.occurredAt),
  ],
);

// A settlement is an obligation for one driver, one aggregator and one period.
// Rate, formula and inputs are copied in, so later policy changes never rewrite it.
export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => settlementPeriods.id),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id),
    aggregatorId: uuid("aggregator_id")
      .notNull()
      .references(() => aggregators.id),
    status: settlementStatus("status").notNull().default("draft"),
    moneyFlowModel: moneyFlowModel("money_flow_model").notNull(),
    commissionPolicyId: uuid("commission_policy_id").references(() => commissionPolicies.id),
    commissionRatePercent: percent("commission_rate_percent").notNull(),
    commissionBaseType: commissionBaseType("commission_base_type").notNull(),
    formulaSnapshot: jsonb("formula_snapshot").notNull(),
    sourceTotals: jsonb("source_totals").notNull(),
    commissionBase: money("commission_base").notNull(),
    commissionAmount: money("commission_amount").notNull(),
    // Park owes the driver (park_collects) / driver owes the park (driver_collects).
    driverPayableAmount: money("driver_payable_amount").notNull().default("0"),
    driverReceivableAmount: money("driver_receivable_amount").notNull().default("0"),
    reversesSettlementId: uuid("reverses_settlement_id"),
    preparedBy: uuid("prepared_by").references(() => users.id),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    check("settlement_amounts_non_negative", sql`${t.driverPayableAmount} >= 0 and ${t.driverReceivableAmount} >= 0`),
    uniqueIndex("settlements_one_live_uq")
      .on(t.periodId, t.driverId)
      .where(sql`${t.status} <> 'reversed' and ${t.reversesSettlementId} is null`),
    uniqueIndex("settlements_reversal_uq").on(t.reversesSettlementId),
    index("settlements_driver_idx").on(t.driverId),
  ],
);

// A transaction is real money that moved. It never stores a balance.
export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: id(),
    type: transactionType("type").notNull(),
    direction: transactionDirection("direction").notNull(),
    amount: money("amount").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    paymentMethod: paymentMethod("payment_method").notNull(),
    driverId: uuid("driver_id").references(() => drivers.id),
    aggregatorId: uuid("aggregator_id").references(() => aggregators.id),
    expenseCategory: text("expense_category"),
    externalId: text("external_id"),
    // Supplied by the client per submit; a retried or doubled request is a no-op.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    approvalStatus: approvalStatus("approval_status").notNull().default("pending"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reversesTransactionId: uuid("reverses_transaction_id").unique(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    check("transaction_amount_positive", sql`${t.amount} > 0`),
    uniqueIndex("transactions_external_uq")
      .on(t.aggregatorId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("transactions_driver_idx").on(t.driverId, t.occurredAt),
    index("transactions_type_idx").on(t.type, t.occurredAt),
  ],
);

// Links one payment to one or more settlements. The sum per transaction is
// capped by a trigger in the custom migration.
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: id(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financialTransactions.id),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id),
    amount: money("amount").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("allocation_amount_positive", sql`${t.amount} > 0`),
    uniqueIndex("allocations_tx_settlement_uq").on(t.transactionId, t.settlementId),
    index("allocations_settlement_idx").on(t.settlementId),
  ],
);

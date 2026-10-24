import { pgEnum } from "drizzle-orm/pg-core";

export const crmStatus = pgEnum("crm_status", [
  "new",
  "documents_review",
  "active",
  "suspended",
  "terminated",
]);

export const licenseStatus = pgEnum("license_status", ["unknown", "valid", "expired", "missing"]);

export const moneyFlowModel = pgEnum("money_flow_model", [
  "park_collects",
  "driver_collects",
  "mixed",
  "unconfirmed",
]);

export const integrationStatus = pgEnum("integration_status", ["file_import", "api", "disabled"]);

export const commissionBaseType = pgEnum("commission_base_type", [
  "gross_earnings",
  "after_aggregator_commission",
  "eligible_driver_earnings",
  "custom",
]);

export const roundingMode = pgEnum("rounding_mode", ["half_up", "half_even", "down"]);

export const periodType = pgEnum("period_type", ["daily", "weekly", "monthly"]);

export const settlementStatus = pgEnum("settlement_status", [
  "draft",
  "needs_review",
  "approved",
  "partially_paid",
  "paid",
  "reversed",
]);

export const importStatus = pgEnum("import_status", [
  "uploaded",
  "validated",
  "committed",
  "failed",
  "cancelled",
]);

export const statementLineStatus = pgEnum("statement_line_status", [
  "valid",
  "invalid",
  "unknown_driver",
  "duplicate",
]);

// What each type means for cash and for obligations is documented in
// docs/finance-model.md; do not add a type without updating it.
export const transactionType = pgEnum("transaction_type", [
  "aggregator_payout_in",
  "driver_payout_out",
  "commission_in",
  "park_expense",
  "driver_other_payment_in",
  "refund",
  "adjustment",
]);

export const transactionDirection = pgEnum("transaction_direction", ["in", "out"]);

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "bank_transfer",
  "card",
  "aggregator_balance",
  "other",
]);

export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const auditResult = pgEnum("audit_result", ["success", "failure", "denied"]);

export const entryStatus = pgEnum("entry_status", ["active", "voided"]);

export const chargeKind = pgEnum("charge_kind", ["subscription", "commission", "other"]);

export const earningSource = pgEnum("earning_source", ["manual", "csv"]);

// Database-level guarantees for financial history. The finance service in a
// later step adds its own checks; these make sure a bug there cannot rewrite
// or double-count money.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import {
  aggregatorStatementLines,
  aggregators,
  auditLogs,
  commissionPolicies,
  drivers,
  financialTransactions,
  importBatches,
  paymentAllocations,
  settlementPeriods,
  settlements,
} from "../src/db/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";
import { createUser, resetDb } from "./helpers.js";

const { db, close } = createDb(TEST_DATABASE_URL, { max: 25 });
afterAll(() => close());

let userId: string;
let aggregatorId: string;
let driverId: string;

beforeAll(async () => {
  await resetDb(db);
});

beforeEach(async () => {
  await resetDb(db);
  userId = await createUser(db, "accountant");
  const [a] = await db.insert(aggregators).values({ code: "agg", name: "Agregator" }).returning();
  aggregatorId = a!.id;
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "Ali", lastName: "Valiyev", phone: "+998901112233" })
    .returning();
  driverId = d!.id;
});

/** Postgres error message, whether drizzle wrapped it or not. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { cause?: { message?: string }; message?: string };
    return e.cause?.message ?? e.message ?? String(err);
  }
  throw new Error("expected the statement to fail");
}

async function makeSettlement(status: "draft" | "approved" = "draft", payable = "900000.00") {
  const [period] = await db
    .insert(settlementPeriods)
    .values({ aggregatorId, periodType: "weekly", startsOn: "2026-10-19", endsOn: "2026-10-25" })
    .onConflictDoNothing()
    .returning();
  const periodId =
    period?.id ?? (await db.select().from(settlementPeriods).where(eq(settlementPeriods.aggregatorId, aggregatorId)))[0]!.id;
  const [s] = await db
    .insert(settlements)
    .values({
      periodId,
      driverId,
      aggregatorId,
      status,
      moneyFlowModel: "park_collects",
      commissionRatePercent: "10.0000",
      commissionBaseType: "gross_earnings",
      formulaSnapshot: { formula: "base * rate / 100" },
      sourceTotals: { gross: "1000000.00" },
      commissionBase: "1000000.00",
      commissionAmount: "100000.00",
      driverPayableAmount: payable,
      preparedBy: userId,
    })
    .returning();
  return s!;
}

async function makeTransaction(amount: string, overrides: Partial<typeof financialTransactions.$inferInsert> = {}) {
  const [t] = await db
    .insert(financialTransactions)
    .values({
      type: "driver_payout_out",
      direction: "out",
      amount,
      occurredAt: new Date(),
      paymentMethod: "cash",
      driverId,
      idempotencyKey: randomUUID(),
      createdBy: userId,
      ...overrides,
    })
    .returning();
  return t!;
}

describe("append-only tables", () => {
  it("audit log rows cannot be edited or deleted", async () => {
    await db.insert(auditLogs).values({ action: "x", entityType: "y", result: "success" });
    expect(await failure(db.update(auditLogs).set({ action: "changed" }))).toMatch(/append-only/);
    expect(await failure(db.delete(auditLogs))).toMatch(/append-only/);
  });
});

describe("settlements", () => {
  it("draft settlements can still be corrected", async () => {
    const s = await makeSettlement("draft");
    await db.update(settlements).set({ commissionAmount: "99000.00" }).where(eq(settlements.id, s.id));
  });

  it("approved figures are frozen, but the status can advance", async () => {
    const s = await makeSettlement("approved");
    expect(
      await failure(db.update(settlements).set({ commissionAmount: "1.00" }).where(eq(settlements.id, s.id))),
    ).toMatch(/frozen/);
    expect(
      await failure(db.update(settlements).set({ commissionRatePercent: "12.0000" }).where(eq(settlements.id, s.id))),
    ).toMatch(/frozen/);
    await db.update(settlements).set({ status: "partially_paid" }).where(eq(settlements.id, s.id));
  });

  it("an approved settlement cannot go back to draft or be deleted", async () => {
    const s = await makeSettlement("approved");
    expect(await failure(db.update(settlements).set({ status: "draft" }).where(eq(settlements.id, s.id)))).toMatch(
      /cannot go back/,
    );
    expect(await failure(db.delete(settlements).where(eq(settlements.id, s.id)))).toMatch(/reversal/);
  });

  it("only one live settlement per driver and period, and one reversal per settlement", async () => {
    const s = await makeSettlement("approved");
    expect(await failure(makeSettlement("draft"))).toMatch(/settlements_one_live_uq/);
    const reversal = {
      periodId: s.periodId,
      driverId,
      aggregatorId,
      status: "approved" as const,
      moneyFlowModel: "park_collects" as const,
      commissionRatePercent: "10.0000",
      commissionBaseType: "gross_earnings" as const,
      formulaSnapshot: {},
      sourceTotals: {},
      commissionBase: "-1000000.00",
      commissionAmount: "-100000.00",
      reversesSettlementId: s.id,
    };
    await db.insert(settlements).values(reversal);
    expect(await failure(db.insert(settlements).values(reversal))).toMatch(/settlements_reversal_uq/);
  });
});

describe("financial transactions", () => {
  it("cannot be deleted", async () => {
    const t = await makeTransaction("100.00");
    expect(await failure(db.delete(financialTransactions).where(eq(financialTransactions.id, t.id)))).toMatch(
      /cannot be deleted/,
    );
  });

  it("are frozen once approved", async () => {
    const t = await makeTransaction("100.00");
    await db
      .update(financialTransactions)
      .set({ approvalStatus: "approved", approvedBy: userId, approvedAt: new Date() })
      .where(eq(financialTransactions.id, t.id));
    expect(
      await failure(db.update(financialTransactions).set({ amount: "50.00" }).where(eq(financialTransactions.id, t.id))),
    ).toMatch(/frozen/);
  });

  it("reject zero and negative amounts", async () => {
    expect(await failure(makeTransaction("0.00"))).toMatch(/transaction_amount_positive/);
    expect(await failure(makeTransaction("-5.00"))).toMatch(/transaction_amount_positive/);
  });

  it("must have a direction that matches the type", async () => {
    expect(await failure(makeTransaction("10.00", { type: "driver_payout_out", direction: "in" }))).toMatch(
      /transaction_type_direction/,
    );
    expect(await failure(makeTransaction("10.00", { type: "commission_in", direction: "out" }))).toMatch(
      /transaction_type_direction/,
    );
  });

  it("the same idempotency key is stored once", async () => {
    const key = randomUUID();
    await makeTransaction("10.00", { idempotencyKey: key });
    expect(await failure(makeTransaction("10.00", { idempotencyKey: key }))).toMatch(/idempotency_key/);
  });

  it("keeps money exact: no float rounding", async () => {
    const t = await makeTransaction("1234567890123456.78");
    const [row] = await db.select().from(financialTransactions).where(eq(financialTransactions.id, t.id));
    expect(row!.amount).toBe("1234567890123456.78");
  });
});

describe("payment allocations", () => {
  // Groundwork for acceptance test 2: 900 000 owed, 600 000 paid, 300 000 left.
  it("partial payment leaves the right remainder", async () => {
    const s = await makeSettlement("approved", "900000.00");
    const t = await makeTransaction("600000.00");
    await db.insert(paymentAllocations).values({ transactionId: t.id, settlementId: s.id, amount: "600000.00", createdBy: userId });
    const [row] = await db.execute<{ remaining: string }>(sql`
      select s.driver_payable_amount - coalesce(sum(a.amount), 0) as remaining
      from settlements s left join payment_allocations a on a.settlement_id = s.id
      where s.id = ${s.id} group by s.id`);
    expect(row!.remaining).toBe("300000.00");
  });

  // Acceptance test 9, at the database level.
  it("cannot allocate more than the transaction amount", async () => {
    const s = await makeSettlement("approved");
    const t = await makeTransaction("600000.00");
    await db.insert(paymentAllocations).values({ transactionId: t.id, settlementId: s.id, amount: "400000.00", createdBy: userId });
    const [period2] = await db
      .insert(settlementPeriods)
      .values({ aggregatorId, periodType: "weekly", startsOn: "2026-10-26", endsOn: "2026-11-01" })
      .returning();
    const [s2] = await db
      .insert(settlements)
      .values({ ...s, id: undefined, periodId: period2!.id, createdAt: undefined, updatedAt: undefined })
      .returning();
    expect(
      await failure(
        db.insert(paymentAllocations).values({ transactionId: t.id, settlementId: s2!.id, amount: "200000.01", createdBy: userId }),
      ),
    ).toMatch(/exceeds/);
    await db.insert(paymentAllocations).values({ transactionId: t.id, settlementId: s2!.id, amount: "200000.00", createdBy: userId });
  });

  it("concurrent allocations cannot jointly overspend a transaction", async () => {
    const t = await makeTransaction("1000.00");
    const targets = [];
    for (let i = 0; i < 20; i++) {
      const [p] = await db
        .insert(settlementPeriods)
        .values({ aggregatorId, periodType: "daily", startsOn: `2026-09-${String(i + 1).padStart(2, "0")}`, endsOn: `2026-09-${String(i + 1).padStart(2, "0")}` })
        .returning();
      targets.push((await makeSettlementIn(p!.id)).id);
    }
    // 20 parallel allocations of 100 against a 1 000 payment: at most 10 may land.
    const results = await Promise.allSettled(
      targets.map((settlementId) =>
        db.insert(paymentAllocations).values({ transactionId: t.id, settlementId, amount: "100.00", createdBy: userId }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const [sum] = await db.execute<{ total: string }>(
      sql`select sum(amount) as total from payment_allocations where transaction_id = ${t.id}`,
    );
    expect(sum!.total).toBe("1000.00");
  });

  it("allocations cannot be edited or deleted", async () => {
    const s = await makeSettlement("approved");
    const t = await makeTransaction("10.00");
    await db.insert(paymentAllocations).values({ transactionId: t.id, settlementId: s.id, amount: "10.00", createdBy: userId });
    expect(await failure(db.delete(paymentAllocations))).toMatch(/append-only/);
  });
});

async function makeSettlementIn(periodId: string) {
  const [s] = await db
    .insert(settlements)
    .values({
      periodId,
      driverId,
      aggregatorId,
      status: "approved",
      moneyFlowModel: "park_collects",
      commissionRatePercent: "10.0000",
      commissionBaseType: "gross_earnings",
      formulaSnapshot: {},
      sourceTotals: {},
      commissionBase: "0",
      commissionAmount: "0",
      driverPayableAmount: "100.00",
    })
    .returning();
  return s!;
}

describe("commission policies", () => {
  const policy = (validFrom: string, validTo: string | null, rate = "10.0000") => ({
    aggregatorId,
    name: `${rate}%`,
    ratePercent: rate,
    baseType: "gross_earnings" as const,
    validFrom,
    validTo,
  });

  it("cannot overlap for one aggregator", async () => {
    await db.insert(commissionPolicies).values(policy("2026-10-01", "2026-11-01"));
    expect(await failure(db.insert(commissionPolicies).values(policy("2026-10-15", null, "12.0000")))).toMatch(
      /commission_policies_no_overlap/,
    );
    // Back-to-back ranges are fine: valid_to is exclusive.
    await db.insert(commissionPolicies).values(policy("2026-11-01", null, "12.0000"));
  });

  // Groundwork for acceptance test 5: the approved 10% policy cannot be rewritten to 12%.
  it("approved policies are frozen except for closing them", async () => {
    const [p] = await db
      .insert(commissionPolicies)
      .values({ ...policy("2026-10-01", null), approvedBy: userId, approvedAt: new Date() })
      .returning();
    expect(
      await failure(db.update(commissionPolicies).set({ ratePercent: "12.0000" }).where(eq(commissionPolicies.id, p!.id))),
    ).toMatch(/frozen/);
    await db.update(commissionPolicies).set({ validTo: "2026-11-01" }).where(eq(commissionPolicies.id, p!.id));
  });

  it("rates outside 0–100% are rejected", async () => {
    expect(await failure(db.insert(commissionPolicies).values(policy("2026-01-01", null, "100.0001")))).toMatch(
      /commission_rate_range/,
    );
  });
});

describe("imports", () => {
  // Groundwork for acceptance test 3.
  it("the same file and the same line cannot be imported twice", async () => {
    const batch = {
      aggregatorId,
      fileName: "report.xlsx",
      fileSha256: "a".repeat(64),
      fileSize: 100,
      uploadedBy: userId,
    };
    const [b] = await db.insert(importBatches).values(batch).returning();
    expect(await failure(db.insert(importBatches).values(batch))).toMatch(/import_batches_file_uq/);

    const line = {
      importBatchId: b!.id,
      aggregatorId,
      rowNumber: 2,
      raw: {},
      lineFingerprint: "fp-1",
      status: "valid" as const,
    };
    await db.insert(aggregatorStatementLines).values(line);
    expect(await failure(db.insert(aggregatorStatementLines).values({ ...line, rowNumber: 3 }))).toMatch(
      /statement_lines_fingerprint_uq/,
    );
    // A row flagged as a duplicate is kept for the import report without counting twice.
    await db.insert(aggregatorStatementLines).values({ ...line, rowNumber: 4, status: "duplicate" });
  });
});

describe("drivers", () => {
  it("an active phone number belongs to one driver; archiving frees it", async () => {
    const dup = { firstName: "Boshqa", lastName: "Haydovchi", phone: "+998901112233" };
    expect(await failure(db.insert(drivers).values(dup))).toMatch(/drivers_phone_active_uq/);
    await db.update(drivers).set({ archivedAt: new Date() }).where(eq(drivers.id, driverId));
    await db.insert(drivers).values(dup);
  });
});

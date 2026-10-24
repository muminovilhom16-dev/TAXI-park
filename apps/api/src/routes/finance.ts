import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  accrueSchema,
  CHARGE_KIND_LABELS,
  financeSettingsSchema,
  PAYMENT_METHOD_LABELS,
  voidSchema,
  type DebtRow,
  type DriverFinance,
  type LedgerEntry,
} from "@taxi/shared";
import { aggregators, appSettings, dailyEarnings, driverCharges, drivers, financialTransactions } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, notFound, parseInput } from "../lib/errors.js";
import { accrueSubscriptions, balancesSql, getFinanceSettings } from "../services/finance.js";

const idParams = z.object({ id: z.string().uuid() });
const debtQuery = z.object({ all: z.enum(["true", "false"]).default("false") });

type BalanceRow = { driver_id: string; charged: string; paid: string; balance: string; pending: string };

export const financeRoutes: FastifyPluginAsync = async (app) => {
  const canRead = app.requirePermission("finance.read");

  app.get("/settings", { preHandler: canRead }, async () => getFinanceSettings(app.db));

  app.put("/settings", { preHandler: app.requirePermission("settings.manage") }, async (req) => {
    const input = parseInput(financeSettingsSchema, req.body);
    return app.db.transaction(async (tx) => {
      const before = await getFinanceSettings(tx);
      const values = [
        { key: "subscription.daily_amount", value: { amount: input.subscriptionDailyAmount } },
        { key: "subscription.charge_mode", value: { mode: input.subscriptionChargeMode } },
        { key: "commission.collection", value: { mode: input.commissionCollection } },
      ];
      for (const v of values) {
        await tx
          .insert(appSettings)
          .values({ ...v, updatedBy: req.auth!.user.id })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: v.value, updatedBy: req.auth!.user.id, updatedAt: sql`now()` },
          });
      }
      const after = await getFinanceSettings(tx);
      await writeAudit(tx, req, { action: "settings.finance_update", entityType: "settings", entityId: "finance", before, after });
      return after;
    });
  });

  // Charges the subscription for one day. Already charged drivers are skipped.
  app.post("/accrue-subscriptions", { preHandler: app.requirePermission("settlements.prepare") }, async (req) => {
    const { date } = parseInput(accrueSchema, req.body);
    return app.db.transaction(async (tx) => {
      const settings = await getFinanceSettings(tx);
      if (!settings.subscriptionEnabled) {
        throw conflict("Obuna summasi yoki hisoblash tartibi sozlanmagan");
      }
      const charged = await accrueSubscriptions(tx, date, settings, { userId: req.auth!.user.id });
      await writeAudit(tx, req, {
        action: "subscription.accrue",
        entityType: "driver_charge",
        after: { date, charged, amount: settings.subscriptionDailyAmount, mode: settings.subscriptionChargeMode },
      });
      return { date, charged };
    });
  });

  app.post("/charges/:id/void", { preHandler: app.requirePermission("settlements.approve") }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const { reason } = parseInput(voidSchema, req.body);
    return app.db.transaction(async (tx) => {
      const [row] = await tx.select().from(driverCharges).where(eq(driverCharges.id, id)).for("update");
      if (!row) throw notFound("Hisoblangan summa");
      if (row.status !== "active") throw conflict("Bu yozuv allaqachon bekor qilingan");
      const [after] = await tx
        .update(driverCharges)
        .set({ status: "voided", voidedBy: req.auth!.user.id, voidedAt: sql`now()`, voidReason: reason })
        .where(eq(driverCharges.id, id))
        .returning();
      await writeAudit(tx, req, { action: "charge.void", entityType: "driver_charge", entityId: id, before: row, after });
      return after;
    });
  });

  // Drivers who owe the park, largest debt first. ?all=true includes zero and credit balances.
  app.get("/debts", { preHandler: canRead }, async (req): Promise<{ items: DebtRow[]; totalDebt: string }> => {
    const q = parseInput(debtQuery, req.query);
    const rows = await app.db.execute<
      BalanceRow & { first_name: string; last_name: string; phone: string; crm_status: string; archived: boolean; oldest: string | null }
    >(sql`
      select b.*, d.first_name, d.last_name, d.phone, d.crm_status, d.archived_at is not null as archived,
        (select min(c.charge_date)::text from driver_charges c where c.driver_id = d.id and c.status = 'active') as oldest
      from (${balancesSql()}) b
      join drivers d on d.id = b.driver_id
      where ${q.all === "true" ? sql`(b.charged > 0 or b.paid <> 0 or b.pending > 0)` : sql`b.balance > 0`}
      order by b.balance desc, d.last_name
    `);
    const items: DebtRow[] = rows.map((r) => ({
      driver: {
        id: r.driver_id,
        fullName: `${r.last_name} ${r.first_name}`,
        phone: r.phone,
        crmStatus: r.crm_status,
        archived: r.archived,
      },
      charged: r.charged,
      paid: r.paid,
      balance: r.balance,
      pendingPayments: r.pending,
      // Oldest charge date as a rough "since when"; payments are not matched to days.
      oldestUnpaidDate: Number(r.balance) > 0 ? r.oldest : null,
    }));
    const [sum] = await app.db.execute<{ total: string }>(
      sql`select coalesce(sum(balance) filter (where balance > 0), 0)::numeric(18,2) as total from (${balancesSql()}) b`,
    );
    return { items, totalDebt: sum?.total ?? "0.00" };
  });

  app.get("/drivers/:id", { preHandler: canRead }, async (req): Promise<DriverFinance> => {
    const { id } = parseInput(idParams, req.params);
    const [exists] = await app.db.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, id));
    if (!exists) throw notFound("Haydovchi");
    const [b] = await app.db.execute<BalanceRow>(balancesSql(sql`d.id = ${id}::uuid`));
    const [charges, payments, earnings] = await Promise.all([
      app.db.select().from(driverCharges).where(eq(driverCharges.driverId, id)).orderBy(desc(driverCharges.chargeDate)).limit(100),
      app.db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.driverId, id))
        .orderBy(desc(financialTransactions.occurredAt))
        .limit(100),
      app.db
        .select({ e: dailyEarnings, aggregatorName: aggregators.name })
        .from(dailyEarnings)
        .innerJoin(aggregators, eq(aggregators.id, dailyEarnings.aggregatorId))
        .where(and(eq(dailyEarnings.driverId, id)))
        .orderBy(desc(dailyEarnings.workDate))
        .limit(100),
    ]);
    const ledger: LedgerEntry[] = [
      ...charges.map((c) => ({
        id: c.id,
        date: c.chargeDate,
        kind: "charge" as const,
        label: CHARGE_KIND_LABELS[c.kind],
        amount: c.amount,
        status: c.status,
        note: c.voidReason ?? c.note,
      })),
      ...payments.map((t) => ({
        id: t.id,
        date: t.occurredAt.toISOString(),
        kind: "payment" as const,
        label:
          t.type === "adjustment" && t.reversesTransactionId
            ? "To'lov bekor qilindi"
            : `To'lov (${PAYMENT_METHOD_LABELS[t.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? t.paymentMethod})`,
        amount: t.direction === "in" ? t.amount : `-${t.amount}`,
        status: t.approvalStatus,
        note: t.note,
      })),
      ...earnings.map(({ e, aggregatorName }) => ({
        id: e.id,
        date: e.workDate,
        kind: "earning" as const,
        label: `Tushum, ${aggregatorName} (komissiya ${e.commissionAmount})`,
        amount: e.grossAmount,
        status: e.status,
        note: e.voidReason ?? e.note,
      })),
    ].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    return {
      balance: b?.balance ?? "0.00",
      charged: b?.charged ?? "0.00",
      paid: b?.paid ?? "0.00",
      pendingPayments: b?.pending ?? "0.00",
      ledger,
    };
  });
};

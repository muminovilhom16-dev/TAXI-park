import { and, between, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { periodQuerySchema, resolvePeriod, tashkentToday, type CrmStats, type FinanceStats } from "@taxi/shared";
import { aggregatorDriverAccounts, drivers } from "../db/schema/index.js";
import { parseInput } from "../lib/errors.js";
import { driverScope } from "../lib/scope.js";
import { balancesSql } from "../services/finance.js";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Formulas are listed in the web app next to each card; keep them in sync.
  app.get(
    "/crm",
    { preHandler: app.requireAnyPermission("drivers.read_all", "drivers.read_assigned") },
    async (req): Promise<CrmStats> => {
      const q = parseInput(periodQuerySchema, req.query);
      const period = resolvePeriod(q.period, q);
      const live = and(driverScope(req), isNull(drivers.archivedAt));
      const n = sql<number>`count(*)::int`;
      const countWhere = async (extra?: ReturnType<typeof and>) =>
        (await app.db.select({ n }).from(drivers).where(and(live, extra)))[0]?.n ?? 0;

      const [totalDrivers, activeDrivers, newDrivers, inactiveDrivers, withoutManager, withoutAggregatorAccount] =
        await Promise.all([
          countWhere(),
          countWhere(eq(drivers.crmStatus, "active")),
          countWhere(between(drivers.registeredOn, period.from, period.to)),
          countWhere(inArray(drivers.crmStatus, ["suspended", "terminated"])),
          countWhere(isNull(drivers.managerId)),
          countWhere(
            notExists(
              app.db
                .select({ one: sql`1` })
                .from(aggregatorDriverAccounts)
                .where(and(eq(aggregatorDriverAccounts.driverId, drivers.id), isNull(aggregatorDriverAccounts.unlinkedAt))),
            ),
          ),
        ]);
      return { period, totalDrivers, activeDrivers, newDrivers, inactiveDrivers, withoutManager, withoutAggregatorAccount };
    },
  );

  // Formulas are shown next to each card in the web app; keep them in sync.
  app.get("/finance", { preHandler: app.requirePermission("finance.read") }, async (req): Promise<FinanceStats> => {
    const q = parseInput(periodQuerySchema, req.query);
    const period = resolvePeriod(q.period, q);
    const yesterday = new Date(Date.parse(`${tashkentToday()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const [row] = await app.db.execute<{
      gross: string;
      commission: string;
      subscriptions: string;
      payments: string;
      debt: string;
      debtors: number;
      pending: number;
      missing: number;
    }>(sql`
      select
        (select coalesce(sum(gross_amount), 0)::numeric(18,2) from daily_earnings
          where status = 'active' and work_date between ${period.from}::date and ${period.to}::date) as gross,
        (select coalesce(sum(commission_amount), 0)::numeric(18,2) from daily_earnings
          where status = 'active' and work_date between ${period.from}::date and ${period.to}::date) as commission,
        (select coalesce(sum(amount), 0)::numeric(18,2) from driver_charges
          where status = 'active' and kind = 'subscription' and charge_date between ${period.from}::date and ${period.to}::date) as subscriptions,
        (select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)::numeric(18,2) from financial_transactions
          where approval_status = 'approved' and driver_id is not null
            and type in ('driver_other_payment_in', 'commission_in', 'adjustment', 'refund')
            and (occurred_at at time zone 'Asia/Tashkent')::date between ${period.from}::date and ${period.to}::date) as payments,
        (select coalesce(sum(balance) filter (where balance > 0), 0)::numeric(18,2) from (${balancesSql()}) b) as debt,
        (select count(*)::int from (${balancesSql()}) b where balance > 0) as debtors,
        (select count(*)::int from financial_transactions where approval_status = 'pending' and type = 'driver_other_payment_in') as pending,
        (select count(*)::int from drivers d where d.archived_at is null and d.crm_status = 'active'
          and not exists (select 1 from daily_earnings e where e.driver_id = d.id and e.work_date = ${yesterday}::date and e.status = 'active')) as missing
    `);
    return {
      period,
      grossEarnings: row!.gross,
      commission: row!.commission,
      subscriptionsCharged: row!.subscriptions,
      paymentsReceived: row!.payments,
      outstandingDebt: row!.debt,
      debtors: row!.debtors,
      pendingPayments: row!.pending,
      missingEarningsYesterday: row!.missing,
    };
  });
};

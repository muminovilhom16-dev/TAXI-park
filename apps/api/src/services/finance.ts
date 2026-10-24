import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  percentOf,
  tashkentToday,
  type CommissionCollectionMode,
  type FinanceSettings,
  type RoundingMode,
  type SubscriptionChargeMode,
} from "@taxi/shared";
import type { Db, DbOrTx, Tx } from "../db/client.js";
import {
  aggregators,
  appSettings,
  commissionPolicies,
  dailyEarnings,
  driverCharges,
  drivers,
} from "../db/schema/index.js";
import { AppError, conflict, isUniqueViolation, notFound } from "../lib/errors.js";

export async function getFinanceSettings(db: DbOrTx): Promise<FinanceSettings> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, ["subscription.daily_amount", "subscription.charge_mode", "commission.collection"]));
  const get = (key: string) => rows.find((r) => r.key === key)?.value as Record<string, unknown> | undefined;
  const amount = (get("subscription.daily_amount")?.amount as string | null | undefined) ?? null;
  const mode = (get("subscription.charge_mode")?.mode as SubscriptionChargeMode | null | undefined) ?? null;
  const collection = (get("commission.collection")?.mode as CommissionCollectionMode | undefined) ?? "withheld";
  return {
    subscriptionDailyAmount: amount,
    subscriptionChargeMode: mode,
    commissionCollection: collection,
    subscriptionEnabled: !!amount && !!mode,
  };
}

/** The approved policy in force on `date` for the aggregator, or null. */
export async function findPolicy(db: DbOrTx, aggregatorId: string, date: string) {
  const [p] = await db
    .select()
    .from(commissionPolicies)
    .where(
      and(
        eq(commissionPolicies.aggregatorId, aggregatorId),
        lte(commissionPolicies.validFrom, date),
        or(isNull(commissionPolicies.validTo), gt(commissionPolicies.validTo, date)),
        sql`${commissionPolicies.approvedAt} is not null`,
      ),
    );
  return p ?? null;
}

export function commissionFor(
  gross: string,
  policy: { ratePercent: string; roundingMode: RoundingMode; roundingScale: number },
) {
  return percentOf(gross, policy.ratePercent, policy.roundingMode, policy.roundingScale as 0 | 1 | 2);
}

export type EarningInput = {
  driverId: string;
  aggregatorId: string;
  workDate: string;
  grossAmount: string;
  note?: string | null;
};

/**
 * Records one day's takings with its frozen commission, plus whatever charges
 * the settings derive from it. Runs inside the caller's transaction.
 */
export async function insertEarning(
  tx: Tx,
  input: EarningInput,
  ctx: { userId: string; settings: FinanceSettings; source: "manual" | "csv"; importBatchId?: string },
) {
  if (input.workDate > tashkentToday()) {
    throw new AppError(400, "future_date", "Kelajakdagi kun uchun tushum kiritib bo'lmaydi");
  }
  const [driver] = await tx
    .select({ id: drivers.id, archivedAt: drivers.archivedAt, registeredOn: drivers.registeredOn })
    .from(drivers)
    .where(eq(drivers.id, input.driverId));
  if (!driver) throw notFound("Haydovchi");
  if (driver.archivedAt) throw new AppError(409, "archived", "Haydovchi arxivda");
  const [agg] = await tx.select({ id: aggregators.id }).from(aggregators).where(eq(aggregators.id, input.aggregatorId));
  if (!agg) throw notFound("Agregator");

  const policy = await findPolicy(tx, input.aggregatorId, input.workDate);
  if (!policy) {
    throw new AppError(
      409,
      "no_commission_policy",
      "Bu agregator va sana uchun komissiya stavkasi belgilanmagan. Sozlamalarda stavka kiriting",
    );
  }
  const commissionAmount = commissionFor(input.grossAmount, policy);

  let row;
  try {
    [row] = await tx
      .insert(dailyEarnings)
      .values({
        driverId: input.driverId,
        aggregatorId: input.aggregatorId,
        workDate: input.workDate,
        grossAmount: input.grossAmount,
        commissionPolicyId: policy.id,
        commissionRatePercent: policy.ratePercent,
        commissionAmount,
        source: ctx.source,
        importBatchId: ctx.importBatchId ?? null,
        note: input.note ?? null,
        createdBy: ctx.userId,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, "earnings_one_active_uq")) {
      throw conflict("Bu haydovchi uchun shu kun va agregator bo'yicha tushum allaqachon kiritilgan");
    }
    throw err;
  }
  if (!row) throw new Error("earning not inserted");

  if (ctx.settings.commissionCollection === "driver_pays" && commissionAmount !== "0.00") {
    await tx.insert(driverCharges).values({
      driverId: row.driverId,
      kind: "commission",
      chargeDate: row.workDate,
      amount: commissionAmount,
      earningId: row.id,
      createdBy: ctx.userId,
    });
  }
  if (ctx.settings.subscriptionEnabled && ctx.settings.subscriptionChargeMode === "worked_days_only") {
    await accrueSubscriptions(tx, row.workDate, ctx.settings, { driverIds: [row.driverId], userId: ctx.userId });
  }
  return row;
}

/** Voids an earning and every charge that exists only because of it. */
export async function voidEarning(tx: Tx, id: string, reason: string, userId: string, settings: FinanceSettings) {
  const [row] = await tx.select().from(dailyEarnings).where(eq(dailyEarnings.id, id)).for("update");
  if (!row) throw notFound("Tushum");
  if (row.status !== "active") throw conflict("Bu yozuv allaqachon bekor qilingan");
  const voided = { status: "voided" as const, voidedBy: userId, voidedAt: sql`now()`, voidReason: reason };
  const [after] = await tx.update(dailyEarnings).set(voided).where(eq(dailyEarnings.id, id)).returning();
  await tx
    .update(driverCharges)
    .set(voided)
    .where(and(eq(driverCharges.earningId, id), eq(driverCharges.status, "active")));

  // With "worked days only", a day with no takings left has no subscription either.
  if (settings.subscriptionChargeMode === "worked_days_only") {
    const [other] = await tx
      .select({ id: dailyEarnings.id })
      .from(dailyEarnings)
      .where(
        and(
          eq(dailyEarnings.driverId, row.driverId),
          eq(dailyEarnings.workDate, row.workDate),
          eq(dailyEarnings.status, "active"),
        ),
      )
      .limit(1);
    if (!other) {
      await tx
        .update(driverCharges)
        .set({ ...voided, voidReason: `Tushum bekor qilindi: ${reason}` })
        .where(
          and(
            eq(driverCharges.driverId, row.driverId),
            eq(driverCharges.chargeDate, row.workDate),
            eq(driverCharges.kind, "subscription"),
            eq(driverCharges.status, "active"),
          ),
        );
    }
  }
  return { before: row, after: after! };
}

/**
 * Charges the daily subscription for `date` to every eligible driver who has
 * not been charged yet. Safe to run any number of times: the partial unique
 * index allows one active subscription charge per driver per day.
 *
 * Eligibility uses the driver's status now, not on `date`; there is no status
 * timeline to replay yet. That is why accrual only reaches back one day on its own.
 */
export async function accrueSubscriptions(
  tx: DbOrTx,
  date: string,
  settings: FinanceSettings,
  opts: { driverIds?: string[]; userId?: string | null } = {},
): Promise<number> {
  if (!settings.subscriptionEnabled) return 0;
  if (date > tashkentToday()) throw new AppError(400, "future_date", "Kelajakdagi kun uchun obuna hisoblanmaydi");
  const amount = settings.subscriptionDailyAmount!;
  const only = opts.driverIds?.length
    ? sql`and d.id in (${sql.join(opts.driverIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;
  const eligible =
    settings.subscriptionChargeMode === "every_active_day"
      ? sql`d.crm_status = 'active'`
      : sql`exists (select 1 from daily_earnings e where e.driver_id = d.id and e.work_date = ${date}::date and e.status = 'active')`;
  const result = await tx.execute(sql`
    insert into driver_charges (driver_id, kind, charge_date, amount, created_by)
    select d.id, 'subscription', ${date}::date, ${amount}::numeric, ${opts.userId ?? null}::uuid
    from drivers d
    where d.archived_at is null and d.registered_on <= ${date}::date and ${eligible} ${only}
    on conflict (driver_id, charge_date) where kind = 'subscription' and status = 'active' do nothing
  `);
  return (result as unknown as { count: number }).count ?? 0;
}

/**
 * Run hourly by the server. With "every active day" the subscription is charged
 * for today; the unique index makes repeated runs, and several servers, harmless.
 * "Worked days only" needs no job: it is charged when the takings are entered.
 */
export async function runScheduledAccrual(db: Db) {
  const settings = await getFinanceSettings(db);
  if (!settings.subscriptionEnabled || settings.subscriptionChargeMode !== "every_active_day") return 0;
  return accrueSubscriptions(db, tashkentToday(), settings);
}

// ---- Balances ----------------------------------------------------------------

/**
 * Per-driver totals as a subquery: charged, paid, balance, pending.
 * Balance = active charges − approved payments; positive means the driver owes
 * the park. An approved incoming payment lowers it; a reversal or refund to the
 * driver raises it again. Payouts of the driver's own earnings do not count.
 */
export function balancesSql(driverFilter = sql`true`) {
  return sql`
    select d.id as driver_id,
      coalesce(c.charged, 0)::numeric(18,2) as charged,
      coalesce(p.paid, 0)::numeric(18,2) as paid,
      (coalesce(c.charged, 0) - coalesce(p.paid, 0))::numeric(18,2) as balance,
      coalesce(p.pending, 0)::numeric(18,2) as pending
    from drivers d
    left join (
      select driver_id, sum(amount) as charged from driver_charges where status = 'active' group by driver_id
    ) c on c.driver_id = d.id
    left join (
      select driver_id,
        sum(case when approval_status = 'approved' then (case when direction = 'in' then amount else -amount end) else 0 end) as paid,
        sum(case when approval_status = 'pending' and direction = 'in' then amount else 0 end) as pending
      from financial_transactions
      where driver_id is not null and type in ('driver_other_payment_in', 'commission_in', 'adjustment', 'refund')
      group by driver_id
    ) p on p.driver_id = d.id
    where ${driverFilter}`;
}

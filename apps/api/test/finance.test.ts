import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tashkentToday } from "@taxi/shared";
import { aggregatorDriverAccounts, aggregators, dailyEarnings, driverCharges, drivers } from "../src/db/schema/index.js";
import { accrueSubscriptions, getFinanceSettings } from "../src/services/finance.js";
import { as, createUser, login, resetDb, setupTestApp, type Session } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;
let owner: Session, accountant: Session, manager: Session, admin: Session;
let aggregatorId: string;
let ali: string, vali: string;

const day = (offset: number) =>
  new Date(Date.parse(`${tashkentToday()}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const TODAY = day(0);
const D1 = day(-3);
const D2 = day(-2);
const D3 = day(-1);

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.teardown());

async function addDriver(firstName: string, phone: string, over: Partial<typeof drivers.$inferInsert> = {}) {
  const [d] = await ctx.db
    .insert(drivers)
    .values({ firstName, lastName: "Test", phone, crmStatus: "active", registeredOn: day(-30), ...over })
    .returning();
  return d!.id;
}

beforeEach(async () => {
  await resetDb(ctx.db);
  for (const r of ["owner", "accountant", "manager", "admin"] as const) await createUser(ctx.db, r);
  [owner, accountant, manager, admin] = (await Promise.all(
    ["owner", "accountant", "manager", "admin"].map((l) => login(ctx.app, l)),
  )) as [Session, Session, Session, Session];
  const [a] = await ctx.db.insert(aggregators).values({ code: "yandex", name: "Yandex Go" }).returning();
  aggregatorId = a!.id;
  ali = await addDriver("Ali", "+998901110001");
  vali = await addDriver("Vali", "+998901110002");
  await ctx.db.insert(aggregatorDriverAccounts).values([
    { aggregatorId, driverId: ali, externalDriverId: "Y-ALI" },
    { aggregatorId, driverId: vali, externalDriverId: "Y-VALI" },
  ]);
});

const setRate = (s: Session, ratePercent: string, validFrom = day(-60)) =>
  as(ctx.app, s).post("/api/commission-policies", { aggregatorId, ratePercent, validFrom });

const enter = (s: Session, driverId: string, workDate: string, grossAmount: string) =>
  as(ctx.app, s).post("/api/earnings", { driverId, aggregatorId, workDate, grossAmount });

const setSettings = (over: Record<string, unknown> = {}) =>
  as(ctx.app, owner).put("/api/finance/settings", {
    subscriptionDailyAmount: "50 000",
    subscriptionChargeMode: "every_active_day",
    commissionCollection: "withheld",
    ...over,
  });

const balance = async (driverId: string) => (await as(ctx.app, accountant).get(`/api/finance/drivers/${driverId}`)).json();

describe("commission rate", () => {
  it("only the owner sets it; a new rate closes the old one without touching past earnings", async () => {
    expect((await setRate(accountant, "10")).statusCode).toBe(403);
    expect((await setRate(owner, "10", day(-60))).statusCode).toBe(201);

    const before = await enter(accountant, ali, D1, "350 000");
    expect(before.statusCode).toBe(201);
    expect(before.json()).toMatchObject({ grossAmount: "350000.00", commissionRatePercent: "10.0000", commissionAmount: "35000.00" });

    expect((await setRate(owner, "12", D2)).statusCode).toBe(201);
    const after = await enter(accountant, ali, D2, "350 000");
    expect(after.json()).toMatchObject({ commissionRatePercent: "12.0000", commissionAmount: "42000.00" });

    // The earlier day keeps the rate it was computed with.
    const [old] = await ctx.db.select().from(dailyEarnings).where(eq(dailyEarnings.id, before.json().id));
    expect(old!.commissionAmount).toBe("35000.00");

    const list = (await as(ctx.app, accountant).get("/api/commission-policies")).json().items;
    expect(list.map((p: { ratePercent: string; validTo: string | null }) => [p.ratePercent, p.validTo])).toEqual([
      ["12.0000", null],
      ["10.0000", D2],
    ]);
    // A rate cannot be slipped in before an existing one.
    expect((await setRate(owner, "11", D1)).statusCode).toBe(409);
  });
});

describe("daily earnings", () => {
  beforeEach(async () => {
    await setRate(owner, "10");
  });

  it("rounds the commission to whole so'm, half up", async () => {
    const res = await enter(accountant, ali, D1, "123455");
    expect(res.json().commissionAmount).toBe("12346.00");
  });

  it("refuses a second entry for the same driver, day and aggregator, also under concurrency", async () => {
    const results = await Promise.all([enter(accountant, ali, D1, "100000"), enter(accountant, ali, D1, "100000")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const rows = await ctx.db.select().from(dailyEarnings).where(eq(dailyEarnings.driverId, ali));
    expect(rows).toHaveLength(1);
  });

  it("refuses future days, unknown aggregators' rates, bad amounts and wrong roles", async () => {
    expect((await enter(accountant, ali, day(1), "100000")).statusCode).toBe(400);
    expect((await enter(accountant, ali, D1, "12,345,000")).statusCode).toBe(400);
    expect((await enter(manager, ali, D1, "100000")).statusCode).toBe(403);
    expect((await enter(admin, ali, D1, "100000")).statusCode).toBe(403);
    const [other] = await ctx.db.insert(aggregators).values({ code: "mytaxi", name: "MyTaxi" }).returning();
    const res = await as(ctx.app, accountant).post("/api/earnings", {
      driverId: ali,
      aggregatorId: other!.id,
      workDate: D1,
      grossAmount: "100000",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("no_commission_policy");
  });

  it("is corrected by voiding (owner only, with a reason) and entering again; rows are never edited", async () => {
    const e = (await enter(accountant, ali, D1, "100000")).json();
    expect((await as(ctx.app, accountant).post(`/api/earnings/${e.id}/void`, { reason: "Xato summa" })).statusCode).toBe(403);
    expect((await as(ctx.app, owner).post(`/api/earnings/${e.id}/void`, { reason: "" })).statusCode).toBe(400);
    expect((await as(ctx.app, owner).post(`/api/earnings/${e.id}/void`, { reason: "Xato summa" })).statusCode).toBe(200);
    expect((await as(ctx.app, owner).post(`/api/earnings/${e.id}/void`, { reason: "Yana" })).statusCode).toBe(409);
    expect((await enter(accountant, ali, D1, "150000")).statusCode).toBe(201);

    await expect(
      ctx.db.update(dailyEarnings).set({ grossAmount: "1.00" }).where(eq(dailyEarnings.id, e.id)),
    ).rejects.toThrow();
    await expect(ctx.db.delete(dailyEarnings).where(eq(dailyEarnings.id, e.id))).rejects.toThrow();

    const list = (await as(ctx.app, accountant).get(`/api/earnings?from=${D1}&to=${D1}&status=all`)).json();
    expect(list.total).toBe(2);
    // Totals count only what stands.
    expect(list.totals).toEqual({ count: 1, grossAmount: "150000.00", commissionAmount: "15000.00" });
  });
});

describe("subscription", () => {
  beforeEach(async () => {
    await setRate(owner, "10");
  });

  it("is off until the owner sets the amount and the rule", async () => {
    const res = await as(ctx.app, accountant).post("/api/finance/accrue-subscriptions", { date: D1 });
    expect(res.statusCode).toBe(409);
    expect((await as(ctx.app, accountant).put("/api/finance/settings", {
      subscriptionDailyAmount: "50000",
      subscriptionChargeMode: "every_active_day",
      commissionCollection: "withheld",
    })).statusCode).toBe(403);
  });

  it("every active day: charges active drivers once per day however often it runs", async () => {
    expect((await setSettings()).statusCode).toBe(200);
    await addDriver("Yangi", "+998901110003", { crmStatus: "new" });
    await addDriver("Toxtatilgan", "+998901110004", { crmStatus: "suspended" });
    await addDriver("Arxiv", "+998901110005", { archivedAt: new Date() });
    await addDriver("Kechagi", "+998901110006", { registeredOn: TODAY });

    const first = await as(ctx.app, accountant).post("/api/finance/accrue-subscriptions", { date: D1 });
    expect(first.json()).toEqual({ date: D1, charged: 2 });
    const again = await as(ctx.app, accountant).post("/api/finance/accrue-subscriptions", { date: D1 });
    expect(again.json().charged).toBe(0);
    // Concurrent runs (two servers, a click during the hourly job) still charge once.
    const settings = await getFinanceSettings(ctx.db);
    await Promise.all([accrueSubscriptions(ctx.db, D2, settings), accrueSubscriptions(ctx.db, D2, settings)]);
    const charges = await ctx.db.select().from(driverCharges).where(eq(driverCharges.driverId, ali));
    expect(charges.map((c) => [c.chargeDate, c.amount]).sort()).toEqual([
      [D1, "50000.00"],
      [D2, "50000.00"],
    ]);
    expect((await as(ctx.app, accountant).post("/api/finance/accrue-subscriptions", { date: day(1) })).statusCode).toBe(400);
  });

  it("worked days only: charged when takings are entered, removed when they are voided", async () => {
    await setSettings({ subscriptionChargeMode: "worked_days_only" });
    const e = (await enter(accountant, ali, D1, "200000")).json();
    expect((await balance(ali)).balance).toBe("50000.00");
    expect((await balance(vali)).balance).toBe("0.00");
    await as(ctx.app, owner).post(`/api/earnings/${e.id}/void`, { reason: "Ishlamagan" });
    expect((await balance(ali)).balance).toBe("0.00");
  });

  it("the commission becomes debt only when the driver pays it to the park", async () => {
    await setSettings({ commissionCollection: "driver_pays", subscriptionChargeMode: "worked_days_only" });
    await enter(accountant, ali, D1, "300000");
    expect((await balance(ali)).balance).toBe("80000.00"); // 30 000 commission + 50 000 subscription
    await setSettings({ commissionCollection: "withheld", subscriptionChargeMode: "worked_days_only" });
    await enter(accountant, ali, D2, "300000");
    expect((await balance(ali)).balance).toBe("130000.00"); // + subscription only
  });
});

describe("payments and debt", () => {
  const pay = (s: Session, amount: string, key = `key-${Math.random()}`) =>
    as(ctx.app, s).post("/api/payments", { driverId: ali, amount, paymentMethod: "cash", idempotencyKey: key });

  beforeEach(async () => {
    await setRate(owner, "10");
    await setSettings();
    await as(ctx.app, accountant).post("/api/finance/accrue-subscriptions", { date: D1 });
    await as(ctx.app, accountant).post("/api/finance/accrue-subscriptions", { date: D2 });
  });

  it("counts a payment only after someone else approves it", async () => {
    expect((await balance(ali)).balance).toBe("100000.00");
    const p = await pay(accountant, "30 000", "same-key-123");
    expect(p.statusCode).toBe(201);
    // A double click returns the same payment.
    const again = await pay(accountant, "30 000", "same-key-123");
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(p.json().id);

    expect(await balance(ali)).toMatchObject({ balance: "100000.00", pendingPayments: "30000.00" });
    expect((await as(ctx.app, accountant).post(`/api/payments/${p.json().id}/approve`)).statusCode).toBe(403);
    expect((await as(ctx.app, owner).post(`/api/payments/${p.json().id}/approve`)).statusCode).toBe(200);
    expect(await balance(ali)).toMatchObject({ balance: "70000.00", paid: "30000.00", pendingPayments: "0.00" });
    expect((await as(ctx.app, owner).post(`/api/payments/${p.json().id}/approve`)).statusCode).toBe(409);

    // The owner cannot approve a payment they entered themselves.
    const own = await pay(owner, "1000");
    expect((await as(ctx.app, owner).post(`/api/payments/${own.json().id}/approve`)).statusCode).toBe(403);
  });

  it("reverses an approved payment once, putting the debt back", async () => {
    const p = (await pay(accountant, "100000")).json();
    await as(ctx.app, owner).post(`/api/payments/${p.id}/approve`);
    expect((await balance(ali)).balance).toBe("0.00");
    expect((await as(ctx.app, owner).post(`/api/payments/${p.id}/reverse`, { reason: "Soxta kvitansiya" })).statusCode).toBe(201);
    expect((await balance(ali)).balance).toBe("100000.00");
    expect((await as(ctx.app, owner).post(`/api/payments/${p.id}/reverse`, { reason: "Yana" })).statusCode).toBe(409);
    const list = (await as(ctx.app, accountant).get(`/api/payments?driverId=${ali}`)).json();
    expect(list.items.find((x: { id: string }) => x.id === p.id)).toMatchObject({ reversed: true });
  });

  it("an overpayment shows as credit and the driver leaves the debtor list", async () => {
    const p = (await pay(accountant, "120000")).json();
    await as(ctx.app, owner).post(`/api/payments/${p.id}/approve`);
    expect((await balance(ali)).balance).toBe("-20000.00");
    const debts = (await as(ctx.app, accountant).get("/api/finance/debts")).json();
    expect(debts.items.map((d: { driver: { id: string } }) => d.driver.id)).toEqual([vali]);
    expect(debts.totalDebt).toBe("100000.00");
  });

  it("lists debtors and summarises the period on the dashboard", async () => {
    await enter(accountant, ali, D3, "400000");
    const p = (await pay(accountant, "40000")).json();
    await as(ctx.app, owner).post(`/api/payments/${p.id}/approve`);
    const debts = (await as(ctx.app, accountant).get("/api/finance/debts")).json();
    expect(debts.items.map((d: { driver: { id: string }; balance: string }) => [d.driver.id, d.balance])).toEqual([
      [vali, "100000.00"],
      [ali, "60000.00"],
    ]);
    expect(debts.items[0].oldestUnpaidDate).toBe(D1);

    const stats = (await as(ctx.app, accountant).get(`/api/dashboard/finance?period=custom&from=${D1}&to=${TODAY}`)).json();
    expect(stats).toMatchObject({
      grossEarnings: "400000.00",
      commission: "40000.00",
      subscriptionsCharged: "200000.00",
      paymentsReceived: "40000.00",
      outstandingDebt: "160000.00",
      debtors: 2,
      pendingPayments: 0,
    });
    expect((await as(ctx.app, manager).get("/api/dashboard/finance")).statusCode).toBe(403);
  });

  it("charges are voided, not deleted, and only by the owner", async () => {
    const [c] = await ctx.db.select().from(driverCharges).where(eq(driverCharges.driverId, ali)).limit(1);
    expect((await as(ctx.app, accountant).post(`/api/finance/charges/${c!.id}/void`, { reason: "Dam olish kuni" })).statusCode).toBe(403);
    expect((await as(ctx.app, owner).post(`/api/finance/charges/${c!.id}/void`, { reason: "Dam olish kuni" })).statusCode).toBe(200);
    expect((await balance(ali)).balance).toBe("50000.00");
    await expect(ctx.db.delete(driverCharges).where(eq(driverCharges.id, c!.id))).rejects.toThrow();
    await expect(ctx.db.execute(sql`update driver_charges set amount = 1 where id = ${c!.id}`)).rejects.toThrow();
  });
});

describe("CSV import", () => {
  beforeEach(async () => {
    await setRate(owner, "10");
  });

  const csv = [
    "sana;agregator_id;summa",
    `${D1};Y-ALI;350 000`,
    `${D1.split("-").reverse().join(".")};Y-VALI;"200 000,50"`,
    `${D2};Y-NOBODY;100000`,
    `${D2};Y-ALI;abc`,
    `${D3};Y-VALI;100000`,
    `${D3};Y-VALI;120000`,
  ].join("\n");

  const preview = (content = csv) =>
    as(ctx.app, accountant).post("/api/earnings/import/preview", { aggregatorId, fileName: "kun.csv", content });

  it("previews every row with a reason, then commits only the valid ones", async () => {
    const p = (await preview()).json();
    expect(p.counts).toEqual({ valid: 2, invalid: 3, unknown_driver: 1, duplicate: 0 });
    expect(p.totals).toEqual({ grossAmount: "550000.50", commissionAmount: "55000.00" });
    expect(p.rows.map((r: { status: string }) => r.status)).toEqual([
      "valid",
      "valid",
      "unknown_driver",
      "invalid",
      "invalid",
      "invalid",
    ]);

    const commit = await as(ctx.app, accountant).post("/api/earnings/import/commit", {
      aggregatorId,
      fileName: "kun.csv",
      content: csv,
      sha256: p.sha256,
    });
    expect(commit.statusCode).toBe(201);
    expect(commit.json().imported).toBe(2);

    // The same file again is refused; a new file with the same rows sees them as already entered.
    const again = await as(ctx.app, accountant).post("/api/earnings/import/commit", {
      aggregatorId,
      fileName: "kun.csv",
      content: csv,
      sha256: p.sha256,
    });
    expect(again.statusCode).toBe(409);
    const second = (await preview(`${csv}\n`)).json();
    expect(second.counts.duplicate).toBe(2);
  });

  it("refuses a commit whose content differs from what was previewed", async () => {
    const p = (await preview()).json();
    const res = await as(ctx.app, accountant).post("/api/earnings/import/commit", {
      aggregatorId,
      fileName: "kun.csv",
      content: csv.replace("350 000", "999 000"),
      sha256: p.sha256,
    });
    expect(res.statusCode).toBe(400);
    expect(await ctx.db.select().from(dailyEarnings)).toHaveLength(0);
  });

  it("matches drivers by phone and explains missing columns", async () => {
    const byPhone = (await preview(`Sana,Telefon,Summa\n${D1},90 111 00 01,100000\n`)).json();
    expect(byPhone.rows[0]).toMatchObject({ status: "valid", driver: { id: ali } });
    const bad = await preview("kun;pul\n2026-10-01;100");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain("summa");
  });
});

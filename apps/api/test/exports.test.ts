import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tashkentToday } from "@taxi/shared";
import { aggregators, auditLogs, drivers } from "../src/db/schema/index.js";
import { as, createUser, login, resetDb, setupTestApp, type Session } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;
let owner: Session, accountant: Session, manager: Session;
let driverId: string;

const yesterday = new Date(Date.parse(`${tashkentToday()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.teardown());

beforeEach(async () => {
  await resetDb(ctx.db);
  for (const r of ["owner", "accountant", "manager"] as const) await createUser(ctx.db, r);
  [owner, accountant, manager] = (await Promise.all(["owner", "accountant", "manager"].map((l) => login(ctx.app, l)))) as [
    Session,
    Session,
    Session,
  ];
  const [a] = await ctx.db.insert(aggregators).values({ code: "yandex", name: "Yandex Go" }).returning();
  // A name that would be a formula in Excel.
  const [d] = await ctx.db
    .insert(drivers)
    .values({ firstName: "Ali", lastName: "=HYPERLINK(1)", phone: "+998901110001", crmStatus: "active", registeredOn: "2026-01-01" })
    .returning();
  driverId = d!.id;
  await as(ctx.app, owner).post("/api/commission-policies", { aggregatorId: a!.id, ratePercent: "10", validFrom: "2026-01-01" });
  await as(ctx.app, owner).put("/api/finance/settings", {
    subscriptionDailyAmount: "40000",
    subscriptionChargeMode: "worked_days_only",
    commissionCollection: "withheld",
  });
  await as(ctx.app, accountant).post("/api/earnings", { driverId, aggregatorId: a!.id, workDate: yesterday, grossAmount: "350000,50" });
});

describe("CSV exports", () => {
  it("exports takings for Excel: BOM, semicolons, decimal comma, formulas neutralised, audited", async () => {
    const res = await as(ctx.app, accountant).get(`/api/earnings/export?from=${yesterday}&to=${yesterday}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`tushum_${yesterday}_${yesterday}.csv`);
    expect(res.body.startsWith("﻿Sana;Haydovchi;")).toBe(true);
    const line = res.body.split("\r\n")[1]!;
    expect(line).toContain(";'=HYPERLINK(1) Ali;998 90 111 00 01;");
    expect(line).toContain(";350000,50;10,0000;35000,00;");
    const audit = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "report.export"));
    expect(audit).toHaveLength(1);
  });

  it("exports debts and payments, negatives stay numbers", async () => {
    const debts = await as(ctx.app, accountant).get("/api/finance/debts/export");
    expect(debts.body.split("\r\n")[1]).toContain(";40000,00;0,00;40000,00;");
    const pay = await as(ctx.app, accountant).post("/api/payments", {
      driverId,
      amount: "40000",
      paymentMethod: "cash",
      idempotencyKey: "export-test-1",
    });
    await as(ctx.app, owner).post(`/api/payments/${pay.json().id}/approve`);
    await as(ctx.app, owner).post(`/api/payments/${pay.json().id}/reverse`, { reason: "Sinov" });
    const payments = await as(ctx.app, accountant).get("/api/payments/export");
    const lines = payments.body.split("\r\n");
    expect(lines[1]).toContain(";40000,00;Tasdiqlangan;");
    expect(lines[2]).toContain(";-40000,00;Tasdiqlangan;");
  });

  it("needs the export right on top of reading finance", async () => {
    expect((await as(ctx.app, manager).get("/api/earnings/export")).statusCode).toBe(403);
    expect((await as(ctx.app, manager).get("/api/finance/debts/export")).statusCode).toBe(403);
    expect((await as(ctx.app, owner).get("/api/payments/export")).statusCode).toBe(200);
  });
});

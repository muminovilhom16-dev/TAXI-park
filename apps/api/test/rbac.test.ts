import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_CODES, type RoleCode } from "@taxi/shared";
import { auditLogs } from "../src/db/schema/index.js";
import { as, createUser, login, resetDb, setupTestApp, type Session } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;
const sessionsByRole = {} as Record<RoleCode, Session>;

beforeAll(async () => {
  ctx = await setupTestApp();
  await resetDb(ctx.db);
  for (const role of ROLE_CODES) {
    await createUser(ctx.db, role);
    sessionsByRole[role] = await login(ctx.app, role);
  }
});
afterAll(() => ctx.teardown());

// Each protected endpoint and the roles allowed to call it by default.
const matrix: { url: string; allowed: RoleCode[] }[] = [
  { url: "/api/commission-policies", allowed: ["owner", "accountant"] },
  { url: "/api/users", allowed: ["owner"] },
  { url: "/api/audit-logs", allowed: ["owner"] },
  { url: "/api/roles", allowed: ["owner", "admin"] },
  { url: "/api/drivers", allowed: ["owner", "admin", "manager", "accountant", "operator"] },
  { url: "/api/dashboard/crm", allowed: ["owner", "admin", "manager", "accountant", "operator"] },
  { url: "/api/aggregators", allowed: ["owner", "admin", "manager", "accountant", "operator"] },
  { url: "/api/vehicles", allowed: ["owner", "admin", "accountant", "operator"] },
  { url: "/api/users/options", allowed: ["owner", "admin", "accountant", "operator"] },
  { url: "/api/earnings", allowed: ["owner", "accountant"] },
  { url: "/api/payments", allowed: ["owner", "accountant"] },
  { url: "/api/finance/debts", allowed: ["owner", "accountant"] },
  { url: "/api/finance/settings", allowed: ["owner", "accountant"] },
  { url: "/api/dashboard/finance", allowed: ["owner", "accountant"] },
];

describe("server-side authorization", () => {
  for (const { url, allowed } of matrix) {
    for (const role of ROLE_CODES) {
      const expected = allowed.includes(role) ? 200 : 403;
      it(`${role} → GET ${url} = ${expected}`, async () => {
        const res = await as(ctx.app, sessionsByRole[role]).get(url);
        expect(res.statusCode).toBe(expected);
      });
    }
  }

  // Acceptance test 7.
  it("refuses a manager on a financial endpoint and audits the attempt", async () => {
    const res = await as(ctx.app, sessionsByRole.manager).get("/api/commission-policies");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
    const denied = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "access.denied"), eq(auditLogs.entityId, "GET /api/commission-policies")));
    expect(denied.length).toBeGreaterThan(0);
  });

  it("refuses an anonymous caller with 401, not 403", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/commission-policies" });
    expect(res.statusCode).toBe(401);
  });

  it("keeps approval rights separate from preparation rights by default", async () => {
    const me = await as(ctx.app, sessionsByRole.accountant).get("/api/auth/me");
    const perms: string[] = me.json().user.permissions;
    expect(perms).toContain("settlements.prepare");
    expect(perms).not.toContain("settlements.approve");
    expect(perms).not.toContain("payments.approve");
  });

  it("gives the manager no financial permission", async () => {
    const me = await as(ctx.app, sessionsByRole.manager).get("/api/auth/me");
    const perms: string[] = me.json().user.permissions;
    for (const p of ["finance.read", "payments.write", "imports.run", "drivers.pii.read"]) {
      expect(perms).not.toContain(p);
    }
  });

  it("gives the owner every permission", async () => {
    const me = await as(ctx.app, sessionsByRole.owner).get("/api/auth/me");
    expect([...me.json().user.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

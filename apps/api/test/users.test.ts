import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "../src/db/schema/index.js";
import { as, createUser, login, resetDb, setupTestApp, type Session } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;
let owner: Session;
let ownerId: string;

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.teardown());
beforeEach(async () => {
  await resetDb(ctx.db);
  ownerId = await createUser(ctx.db, "owner");
  owner = await login(ctx.app, "owner");
});

const newUser = {
  fullName: "Aziz Karimov",
  login: "Aziz.K",
  phone: "90 123 45 67",
  roleCode: "accountant",
  password: "boshlang-ich-parol",
};

describe("staff management", () => {
  it("creates a user with a normalized login and phone, and audits it without the password", async () => {
    const res = await as(ctx.app, owner).post("/api/users", newUser);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ login: "aziz.k", phone: "+998901234567", role: { code: "accountant" }, isActive: true });
    expect(body).not.toHaveProperty("passwordHash");

    const [entry] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "user.create"));
    expect(entry!.entityId).toBe(body.id);
    expect(JSON.stringify(entry!.after)).not.toMatch(/boshlang-ich-parol|argon2/);

    await login(ctx.app, "aziz.k", newUser.password);
  });

  it("rejects a duplicate login regardless of case", async () => {
    await as(ctx.app, owner).post("/api/users", newUser);
    const res = await as(ctx.app, owner).post("/api/users", { ...newUser, login: "AZIZ.K" });
    expect(res.statusCode).toBe(409);
  });

  it("validates input", async () => {
    const res = await as(ctx.app, owner).post("/api/users", { ...newUser, password: "short", phone: "123" });
    expect(res.statusCode).toBe(400);
    const paths = res.json().error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain("password");
  });

  it("rejects a malformed phone number", async () => {
    const res = await as(ctx.app, owner).post("/api/users", { ...newUser, phone: "123" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].path).toBe("phone");
  });

  it("lists, searches and paginates", async () => {
    await createUser(ctx.db, "operator", "op1");
    await createUser(ctx.db, "operator", "op2");
    const page = await as(ctx.app, owner).get("/api/users?role=operator&pageSize=1&page=2");
    expect(page.json()).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.json().items).toHaveLength(1);
    const search = await as(ctx.app, owner).get("/api/users?q=op1");
    expect(search.json().items.map((u: { login: string }) => u.login)).toEqual(["op1"]);
    const literal = await as(ctx.app, owner).get(`/api/users?q=${encodeURIComponent("%")}`);
    expect(literal.json().total).toBe(0);
  });

  it("deactivating a user signs them out immediately", async () => {
    const id = await createUser(ctx.db, "operator", "op.one");
    const op = await login(ctx.app, "op.one");
    const res = await as(ctx.app, owner).patch(`/api/users/${id}`, { isActive: false });
    expect(res.statusCode).toBe(200);
    expect((await as(ctx.app, op).get("/api/auth/me")).statusCode).toBe(401);
    await expect(login(ctx.app, "op.one")).rejects.toThrow();
  });

  it("a role change takes effect on the next request", async () => {
    const id = await createUser(ctx.db, "accountant", "acc");
    await as(ctx.app, owner).patch(`/api/users/${id}`, { roleCode: "manager" });
    const acc = await login(ctx.app, "acc");
    expect((await as(ctx.app, acc).get("/api/commission-policies")).statusCode).toBe(403);
  });

  it("resetting a password signs the user out", async () => {
    const id = await createUser(ctx.db, "operator", "op.one");
    const op = await login(ctx.app, "op.one");
    const res = await as(ctx.app, owner).post(`/api/users/${id}/reset-password`, { password: "yangi-parol-789" });
    expect(res.statusCode).toBe(200);
    expect((await as(ctx.app, op).get("/api/auth/me")).statusCode).toBe(401);
    await login(ctx.app, "op.one", "yangi-parol-789");
  });

  it("forbids changing your own role or deactivating yourself", async () => {
    const r1 = await as(ctx.app, owner).patch(`/api/users/${ownerId}`, { roleCode: "admin" });
    const r2 = await as(ctx.app, owner).patch(`/api/users/${ownerId}`, { isActive: false });
    expect([r1.statusCode, r2.statusCode]).toEqual([400, 400]);
  });

  // Only reachable through a race while every users.manage holder is an owner.
  it("refuses to remove the last owner even when two requests race", async () => {
    const otherId = await createUser(ctx.db, "owner", "owner2");
    const other = await login(ctx.app, "owner2");
    const [a, b] = await Promise.all([
      as(ctx.app, owner).patch(`/api/users/${otherId}`, { roleCode: "admin" }),
      as(ctx.app, other).patch(`/api/users/${ownerId}`, { roleCode: "admin" }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // Exactly one demotion may win; the other must see the remaining owner gone.
    expect(codes).toEqual([200, 400].sort());
  });

  it("returns 404 for an unknown user", async () => {
    const res = await as(ctx.app, owner).patch(`/api/users/00000000-0000-0000-0000-000000000000`, { fullName: "Hech kim" });
    expect(res.statusCode).toBe(404);
  });

});

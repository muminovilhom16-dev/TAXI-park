import { desc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, sessions } from "../src/db/schema/index.js";
import { as, createUser, login, PASSWORD, resetDb, setupTestApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.teardown());
beforeEach(async () => {
  await resetDb(ctx.db);
  await createUser(ctx.db, "owner", "owner");
});

describe("login", () => {
  it("sets an httpOnly, SameSite=Strict session cookie and exposes the user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: "OWNER", password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === "taxi_sid")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Strict");

    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `taxi_sid=${c.value}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.role.code).toBe("owner");
    expect(me.json().user.permissions).toContain("users.manage");
    expect(me.json().csrfToken).toMatch(/.{20,}/);
  });

  it("stores only a hash of the session token", async () => {
    const s = await login(ctx.app, "owner");
    const raw = s.cookie.split("=")[1]!;
    const rows = await ctx.db.select({ id: sessions.id }).from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(raw);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same answer for a wrong password, an unknown login and an inactive user", async () => {
    await createUser(ctx.db, "operator", "sleeping", { isActive: false });
    const attempts = [
      { login: "owner", password: "wrong-password" },
      { login: "nobody", password: PASSWORD },
      { login: "sleeping", password: PASSWORD },
    ];
    for (const payload of attempts) {
      const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toEqual({ code: "bad_credentials", message: "Login yoki parol noto'g'ri" });
    }
  });

  it("audits failed attempts without the password", async () => {
    await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "owner", password: "secret-guess-1" } });
    const [row] = await ctx.db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
    expect(row!.action).toBe("auth.login");
    expect(row!.result).toBe("failure");
    expect(JSON.stringify({ ...row, id: String(row!.id) })).not.toContain("secret-guess-1");
  });

  it("rate limits login attempts per IP", async () => {
    const limited = await setupTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: 3 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await limited.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { login: "owner", password: "wrong-password" },
        });
        codes.push(res.statusCode);
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.teardown();
    }
  });

  it("rejects malformed input with field-level errors", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "a" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });
});

describe("session protection", () => {
  it("requires a session", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses writes without the CSRF token", async () => {
    const s = await login(ctx.app, "owner");
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("csrf");
  });

  it("refuses writes from a foreign Origin", async () => {
    const s = await login(ctx.app, "owner");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("bad_origin");
  });

  it("logout revokes the session on the server", async () => {
    const s = await login(ctx.app, "owner");
    expect((await as(ctx.app, s).post("/api/auth/logout")).statusCode).toBe(200);
    expect((await as(ctx.app, s).get("/api/auth/me")).statusCode).toBe(401);
  });

  it("changing the password signs out other sessions", async () => {
    const phone = await login(ctx.app, "owner");
    const laptop = await login(ctx.app, "owner");
    const res = await as(ctx.app, laptop).post("/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "yangi-parol-456",
    });
    expect(res.statusCode).toBe(200);
    expect((await as(ctx.app, phone).get("/api/auth/me")).statusCode).toBe(401);
    await login(ctx.app, "owner", "yangi-parol-456");
  });
});

describe("health", () => {
  it("answers without a session", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toEqual({ ok: true });
  });
});


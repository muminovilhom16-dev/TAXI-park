import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { changeOwnPasswordSchema, loginSchema, type MeResponse } from "@taxi/shared";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, revokeSession, revokeUserSessions } from "../auth/sessions.js";
import { users } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, parseInput } from "../lib/errors.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  const secure = app.env.NODE_ENV === "production";

  const setCookie = (reply: FastifyReply, value: string, expires: Date) =>
    reply.setCookie(app.sessionCookie, value, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      expires,
    });

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: app.env.LOGIN_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const input = parseInput(loginSchema, req.body);
      const [user] = await app.db
        .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
        .from(users)
        .where(sql`lower(${users.login}) = lower(${input.login})`)
        .limit(1);

      const ok = await verifyPassword(user?.passwordHash ?? null, input.password);
      if (!user || !ok || !user.isActive) {
        await writeAudit(app.db, req, {
          action: "auth.login",
          entityType: "user",
          entityId: user?.id ?? null,
          result: "failure",
          actorUserId: null,
          after: { login: input.login, reason: !user || !ok ? "bad_credentials" : "inactive" },
        });
        // One message for every failure, so it does not reveal which logins exist.
        throw new AppError(401, "bad_credentials", "Login yoki parol noto'g'ri");
      }

      const session = await createSession(app.db, {
        userId: user.id,
        ttlHours: app.env.SESSION_TTL_HOURS,
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await writeAudit(app.db, req, {
        action: "auth.login",
        entityType: "user",
        entityId: user.id,
        actorUserId: user.id,
      });
      setCookie(reply, session.rawToken, session.expiresAt);
      return { ok: true };
    },
  );

  app.post("/logout", async (req, reply) => {
    if (req.auth) {
      await revokeSession(app.db, req.auth.sessionId);
      await writeAudit(app.db, req, { action: "auth.logout", entityType: "user", entityId: req.auth.user.id });
    }
    reply.clearCookie(app.sessionCookie, { path: "/" });
    return { ok: true };
  });

  app.get("/me", { preHandler: app.requireAuth }, async (req): Promise<MeResponse> => {
    const auth = req.auth!;
    return { user: auth.user, csrfToken: auth.csrfToken };
  });

  app.post("/change-password", { preHandler: app.requireAuth }, async (req, reply) => {
    const input = parseInput(changeOwnPasswordSchema, req.body);
    const userId = req.auth!.user.id;
    const [user] = await app.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!user || !(await verifyPassword(user.hash, input.currentPassword))) {
      await writeAudit(app.db, req, { action: "auth.change_password", entityType: "user", entityId: userId, result: "failure" });
      throw new AppError(400, "bad_password", "Joriy parol noto'g'ri");
    }
    const hash = await hashPassword(input.newPassword);
    await app.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));
      // Every other device is signed out; this one gets a fresh session.
      await revokeUserSessions(tx, userId);
      await writeAudit(tx, req, { action: "auth.change_password", entityType: "user", entityId: userId });
    });
    const session = await createSession(app.db, {
      userId,
      ttlHours: app.env.SESSION_TTL_HOURS,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
    setCookie(reply, session.rawToken, session.expiresAt);
    return { ok: true };
  });
};

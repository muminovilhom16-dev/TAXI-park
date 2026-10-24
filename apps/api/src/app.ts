import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Permission } from "@taxi/shared";
import { loadSession, type AuthContext } from "./auth/sessions.js";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { writeAudit } from "./lib/audit.js";
import { AppError, forbidden, unauthorized } from "./lib/errors.js";
import { auditRoutes } from "./routes/audit.js";
import { authRoutes } from "./routes/auth.js";
import { aggregatorRoutes } from "./routes/aggregators.js";
import { commissionRoutes } from "./routes/commission.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { driverRoutes } from "./routes/drivers.js";
import { earningRoutes } from "./routes/earnings.js";
import { financeRoutes } from "./routes/finance.js";
import { healthRoutes } from "./routes/health.js";
import { paymentRoutes } from "./routes/payments.js";
import { roleRoutes } from "./routes/roles.js";
import { userRoutes } from "./routes/users.js";
import { vehicleRoutes } from "./routes/vehicles.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    env: Env;
    sessionCookie: string;
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requirePermission: (...perms: Permission[]) => (req: FastifyRequest) => Promise<void>;
    requireAnyPermission: (...perms: Permission[]) => (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(deps: { db: Db; env: Env }) {
  const { env } = deps;
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : { level: "info", redact: ["req.headers.cookie", "req.headers['x-csrf-token']"] },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });

  app.decorate("db", deps.db);
  app.decorate("env", env);
  // __Host- forces Secure, Path=/ and no Domain in production browsers.
  app.decorate("sessionCookie", env.NODE_ENV === "production" ? "__Host-taxi_sid" : "taxi_sid");
  app.decorateRequest("auth", null);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook("onRequest", async (req) => {
    const raw = req.cookies[app.sessionCookie];
    req.auth = raw ? await loadSession(app.db, raw, env.SESSION_TTL_HOURS) : null;

    if (SAFE_METHODS.has(req.method)) return;
    // Browsers always send Origin on cross-site writes; refuse anything not ours.
    const origin = req.headers.origin;
    if (origin && origin !== env.WEB_ORIGIN) {
      throw new AppError(403, "bad_origin", "So'rov manbai ruxsat etilmagan");
    }
    if (req.auth && req.headers["x-csrf-token"] !== req.auth.csrfToken) {
      throw new AppError(403, "csrf", "Sessiya tokeni noto'g'ri. Sahifani yangilang");
    }
  });

  app.decorate("requireAuth", async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
  });

  const guard = (mode: "all" | "any", perms: Permission[]) => async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
    const granted = req.auth.user.permissions;
    const ok = mode === "all" ? perms.every((p) => granted.includes(p)) : perms.some((p) => granted.includes(p));
    if (!ok) {
      await writeAudit(app.db, req, {
        action: "access.denied",
        entityType: "endpoint",
        entityId: `${req.method} ${req.routeOptions.url ?? req.url}`,
        result: "denied",
        after: { required: perms, mode },
      });
      throw forbidden();
    }
  };
  app.decorate("requirePermission", (...perms: Permission[]) => guard("all", perms));
  app.decorate("requireAnyPermission", (...perms: Permission[]) => guard("any", perms));

  app.setErrorHandler((err, req, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply
        .status(429)
        .send({ error: { code: "rate_limited", message: "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring" } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "bad_request", message: "So'rov noto'g'ri" } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Serverda kutilmagan xato yuz berdi" } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Manzil topilmadi" } }),
  );

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(userRoutes, { prefix: "/api/users" });
  await app.register(roleRoutes, { prefix: "/api/roles" });
  await app.register(auditRoutes, { prefix: "/api/audit-logs" });
  await app.register(commissionRoutes, { prefix: "/api/commission-policies" });
  await app.register(driverRoutes, { prefix: "/api/drivers" });
  await app.register(aggregatorRoutes, { prefix: "/api/aggregators" });
  await app.register(vehicleRoutes, { prefix: "/api/vehicles" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(earningRoutes, { prefix: "/api/earnings" });
  await app.register(paymentRoutes, { prefix: "/api/payments" });
  await app.register(financeRoutes, { prefix: "/api/finance" });

  return app;
}

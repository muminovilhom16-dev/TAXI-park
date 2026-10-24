import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationSchema, type AuditLogRow, type Paginated } from "@taxi/shared";
import { auditLogs, users } from "../db/schema/index.js";
import { parseInput } from "../lib/errors.js";

const listQuery = paginationSchema.extend({
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.string().uuid().optional(),
  result: z.enum(["success", "failure", "denied"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("audit.read") }, async (req): Promise<Paginated<AuditLogRow>> => {
    const q = parseInput(listQuery, req.query);
    const where = and(
      q.action ? eq(auditLogs.action, q.action) : undefined,
      q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
      q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
      q.actorId ? eq(auditLogs.actorUserId, q.actorId) : undefined,
      q.result ? eq(auditLogs.result, q.result) : undefined,
      q.from ? gte(auditLogs.createdAt, q.from) : undefined,
      q.to ? lt(auditLogs.createdAt, q.to) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      app.db
        .select({
          id: auditLogs.id,
          createdAt: auditLogs.createdAt,
          actorId: users.id,
          actorName: users.fullName,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          result: auditLogs.result,
          before: auditLogs.before,
          after: auditLogs.after,
          ip: auditLogs.ip,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(where)
        .orderBy(desc(auditLogs.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      app.db.select({ n: count() }).from(auditLogs).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id.toString(),
        createdAt: r.createdAt.toISOString(),
        actor: r.actorId ? { id: r.actorId, fullName: r.actorName ?? "" } : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        result: r.result,
        before: r.before,
        after: r.after,
        ip: r.ip,
      })),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
};

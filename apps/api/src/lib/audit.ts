import type { FastifyRequest } from "fastify";
import type { DbOrTx } from "../db/client.js";
import { auditLogs } from "../db/schema/index.js";

// Matches password, passwordHash, csrfToken, apiSecret, sessionId and the like.
const SECRET_KEYS = /password|token|secret|^cookie$|^session(_?id)?$/i;

/** Removes secrets at any depth before a value is written to the log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEYS.test(k))
        .map(([k, v]) => [k, redact(v)]),
    );
  }
  return value;
}

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  result?: "success" | "failure" | "denied";
  before?: unknown;
  after?: unknown;
  actorUserId?: string | null;
};

/**
 * Writes one audit row. Pass the transaction handle that made the change so
 * the change and its audit entry commit or roll back together.
 */
export async function writeAudit(db: DbOrTx, req: FastifyRequest | null, entry: AuditEntry) {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : (req?.auth?.user.id ?? null),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    result: entry.result ?? "success",
    before: entry.before === undefined ? null : redact(entry.before),
    after: entry.after === undefined ? null : redact(entry.after),
    ip: req?.ip ?? null,
    userAgent: req?.headers["user-agent"]?.slice(0, 300) ?? null,
  });
}

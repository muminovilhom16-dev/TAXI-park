import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Permission, RoleCode, SessionUser } from "@taxi/shared";
import type { DbOrTx } from "../db/client.js";
import { rolePermissions, roles, sessions, users } from "../db/schema/index.js";

export type AuthContext = { sessionId: string; csrfToken: string; user: SessionUser };

const token = () => randomBytes(32).toString("base64url");
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

// Refresh the sliding expiry at most this often, to avoid a write per request.
const TOUCH_INTERVAL_MS = 5 * 60_000;

export async function createSession(
  db: DbOrTx,
  input: { userId: string; ttlHours: number; ip: string | null; userAgent: string | null },
) {
  const raw = token();
  const csrfToken = token();
  const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);
  await db.insert(sessions).values({
    id: hashToken(raw),
    userId: input.userId,
    csrfToken,
    expiresAt,
    ip: input.ip,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  return { rawToken: raw, csrfToken, expiresAt };
}

export async function loadSession(db: DbOrTx, rawToken: string, ttlHours: number): Promise<AuthContext | null> {
  const id = hashToken(rawToken);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      csrfToken: sessions.csrfToken,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      fullName: users.fullName,
      login: users.login,
      roleId: roles.id,
      roleCode: roles.code,
      roleName: roles.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.isActive, true)))
    .limit(1);
  if (!row) return null;

  const perms = await db
    .select({ code: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, row.roleId));

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ttlHours * 3_600_000) })
      .where(eq(sessions.id, id));
  }

  return {
    sessionId: row.sessionId,
    csrfToken: row.csrfToken,
    user: {
      id: row.userId,
      fullName: row.fullName,
      login: row.login,
      role: { code: row.roleCode as RoleCode, name: row.roleName },
      permissions: perms.map((p) => p.code as Permission),
    },
  };
}

export async function revokeSession(db: DbOrTx, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeUserSessions(db: DbOrTx, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(db: DbOrTx) {
  await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
}

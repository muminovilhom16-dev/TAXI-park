import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createUserSchema,
  normalizeUzPhone,
  paginationSchema,
  resetPasswordSchema,
  updateUserSchema,
  type Paginated,
  type RoleCode,
  type UserRow,
} from "@taxi/shared";
import { hashPassword } from "../auth/password.js";
import { revokeUserSessions } from "../auth/sessions.js";
import type { DbOrTx } from "../db/client.js";
import { roles, users } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, conflict, isUniqueViolation, notFound, parseInput } from "../lib/errors.js";
import { containsPattern } from "../lib/sql.js";

const listQuery = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  role: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
});
const idParams = z.object({ id: z.string().uuid() });

const userColumns = {
  id: users.id,
  fullName: users.fullName,
  login: users.login,
  phone: users.phone,
  roleCode: roles.code,
  roleName: roles.name,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

type UserSelect = {
  id: string;
  fullName: string;
  login: string;
  phone: string | null;
  roleCode: string;
  roleName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const toRow = (u: UserSelect): UserRow => ({
  id: u.id,
  fullName: u.fullName,
  login: u.login,
  phone: u.phone,
  role: { code: u.roleCode as RoleCode, name: u.roleName },
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

async function findUser(db: DbOrTx, id: string, lock = false) {
  const q = db.select(userColumns).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, id));
  const [row] = lock ? await q.for("update", { of: users }) : await q;
  return row;
}

async function roleId(db: DbOrTx, code: RoleCode) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, code));
  if (!role) throw new AppError(400, "unknown_role", "Rol topilmadi");
  return role.id;
}

function cleanPhone(phone: string | null | undefined) {
  if (!phone) return null;
  const normalized = normalizeUzPhone(phone);
  if (!normalized) {
    throw new AppError(400, "validation_error", "Ma'lumotlar noto'g'ri kiritilgan", [
      { path: "phone", message: "Telefon raqami +998XXXXXXXXX ko'rinishida bo'lsin" },
    ]);
  }
  return normalized;
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  const canManage = app.requirePermission("users.manage");

  app.get("/", { preHandler: canManage }, async (req): Promise<Paginated<UserRow>> => {
    const q = parseInput(listQuery, req.query);
    const filters = [
      q.q ? or(ilike(users.fullName, containsPattern(q.q)), ilike(users.login, containsPattern(q.q))) : undefined,
      q.role ? eq(roles.code, q.role) : undefined,
      q.active ? eq(users.isActive, q.active === "true") : undefined,
    ];
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      app.db
        .select(userColumns)
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(where)
        .orderBy(asc(users.fullName))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      app.db.select({ n: count() }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where),
    ]);
    return { items: rows.map(toRow), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  });

  app.post("/", { preHandler: canManage }, async (req, reply) => {
    const input = parseInput(createUserSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    try {
      const created = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            fullName: input.fullName,
            login: input.login,
            phone: cleanPhone(input.phone),
            passwordHash,
            roleId: await roleId(tx, input.roleCode),
          })
          .returning({ id: users.id });
        const user = toRow((await findUser(tx, row!.id))!);
        await writeAudit(tx, req, { action: "user.create", entityType: "user", entityId: user.id, after: user });
        return user;
      });
      return reply.status(201).send(created);
    } catch (err) {
      if (isUniqueViolation(err, "users_login_lower_uq")) throw conflict("Bu login band");
      throw err;
    }
  });

  app.patch("/:id", { preHandler: canManage }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateUserSchema, req.body);
    const self = req.auth!.user.id === id;
    if (self && (input.roleCode !== undefined || input.isActive === false)) {
      throw new AppError(400, "self_change", "O'z rolingizni o'zgartira yoki o'zingizni o'chira olmaysiz");
    }

    return app.db.transaction(async (tx) => {
      // Role or activity changes lock every active owner first, always in id
      // order, so concurrent demotions serialise instead of deadlocking.
      const activeOwners =
        input.roleCode !== undefined || input.isActive !== undefined
          ? await tx
              .select({ id: users.id })
              .from(users)
              .innerJoin(roles, eq(roles.id, users.roleId))
              .where(and(eq(roles.code, "owner"), eq(users.isActive, true)))
              .orderBy(asc(users.id))
              .for("update", { of: users })
          : [];

      const before = await findUser(tx, id, true);
      if (!before) throw notFound("Xodim");

      const losesOwner =
        before.roleCode === "owner" &&
        before.isActive &&
        ((input.roleCode !== undefined && input.roleCode !== "owner") || input.isActive === false);
      if (losesOwner && !activeOwners.some((o) => o.id !== id)) {
        throw new AppError(400, "last_owner", "Tizimda kamida bitta faol egasi qolishi kerak");
      }

      await tx
        .update(users)
        .set({
          ...(input.fullName !== undefined && { fullName: input.fullName }),
          ...(input.phone !== undefined && { phone: cleanPhone(input.phone) }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.roleCode !== undefined && { roleId: await roleId(tx, input.roleCode) }),
        })
        .where(eq(users.id, id));

      const roleChanged = input.roleCode !== undefined && input.roleCode !== before.roleCode;
      if (input.isActive === false || roleChanged) await revokeUserSessions(tx, id);

      const after = toRow((await findUser(tx, id))!);
      await writeAudit(tx, req, {
        action: "user.update",
        entityType: "user",
        entityId: id,
        before: toRow(before),
        after,
      });
      return after;
    });
  });

  app.post("/:id/reset-password", { preHandler: canManage }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(resetPasswordSchema, req.body);
    const hash = await hashPassword(input.password);
    await app.db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({ passwordHash: hash })
        .where(eq(users.id, id))
        .returning({ id: users.id });
      if (updated.length === 0) throw notFound("Xodim");
      await revokeUserSessions(tx, id);
      await writeAudit(tx, req, { action: "user.reset_password", entityType: "user", entityId: id });
    });
    return { ok: true };
  });
};


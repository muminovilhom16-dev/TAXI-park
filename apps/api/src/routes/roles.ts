import { asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { rolePermissions, roles } from "../db/schema/index.js";

export const roleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("roles.read") }, async () => {
    const rows = await app.db
      .select({ code: roles.code, name: roles.name, permission: rolePermissions.permissionCode })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .orderBy(asc(roles.code), asc(rolePermissions.permissionCode));
    const byRole = new Map<string, { code: string; name: string; permissions: string[] }>();
    for (const r of rows) {
      const entry = byRole.get(r.code) ?? { code: r.code, name: r.name, permissions: [] };
      if (r.permission) entry.permissions.push(r.permission);
      byRole.set(r.code, entry);
    }
    return { items: [...byRole.values()] };
  });
};

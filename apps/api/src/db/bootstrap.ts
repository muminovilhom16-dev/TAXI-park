import { sql } from "drizzle-orm";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_NAMES,
} from "@taxi/shared";
import type { Db } from "./client.js";
import { appSettings, permissions, rolePermissions, roles } from "./schema/index.js";

// Defaults that are business settings, not code constants. Changing them later
// goes through settings with an audit entry; existing values are never overwritten.
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "commission.default_rate_percent": "10.0000",
  "money.rounding": { mode: "half_up", scale: 0 },
  "time.zone": "Asia/Tashkent",
  // No threshold until the owner sets one.
  "debt.alert_threshold": { amount: null },
  "finance.require_separate_approver": true,
};

/**
 * Idempotent: brings permissions and system roles in line with the code, and
 * inserts missing settings. Runs after every migration, in dev and production.
 */
export async function bootstrapReferenceData(db: Db) {
  await db.transaction(async (tx) => {
    const permRows = Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description }));
    await tx
      .insert(permissions)
      .values(permRows)
      .onConflictDoUpdate({ target: permissions.code, set: { description: sql`excluded.description` } });

    for (const code of ROLE_CODES) {
      const [role] = await tx
        .insert(roles)
        .values({ code, name: ROLE_NAMES[code], isSystem: true })
        .onConflictDoUpdate({ target: roles.code, set: { name: ROLE_NAMES[code] } })
        .returning({ id: roles.id });
      if (!role) throw new Error(`role ${code} was not created`);
      // System roles are owned by code: replace their bundle on every bootstrap.
      await tx.delete(rolePermissions).where(sql`${rolePermissions.roleId} = ${role.id}`);
      const bundle = DEFAULT_ROLE_PERMISSIONS[code];
      if (bundle.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(bundle.map((permissionCode) => ({ roleId: role.id, permissionCode })));
      }
    }

    await tx
      .insert(appSettings)
      .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
      .onConflictDoNothing();
  });
}

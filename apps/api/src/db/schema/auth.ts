import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns.js";

export const roles = pgTable("roles", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(true),
  ...timestamps(),
});

export const permissions = pgTable("permissions", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permissions.code, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    fullName: text("full_name").notNull(),
    login: text("login").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_login_lower_uq").on(sql`lower(${t.login})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    // sha256 of the cookie token; the raw token is never stored.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

import { z } from "zod";
import { ROLE_CODES, type Permission, type RoleCode } from "./permissions.js";

/** Every API error has this shape, so the client can render it uniformly. */
export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export const loginSchema = z.object({
  login: z.string().trim().min(3).max(64),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(10, "Parol kamida 10 ta belgidan iborat bo'lishi kerak")
  .max(200);

export const loginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,64}$/, "Login faqat lotin harflari, raqamlar, '.', '_' va '-' dan iborat bo'lsin");

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  login: loginNameSchema,
  phone: z.string().trim().max(32).optional().nullable(),
  roleCode: z.enum(ROLE_CODES),
  password: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(32).nullable(),
    roleCode: z.enum(ROLE_CODES),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Kamida bitta maydon kerak");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });

export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export type SessionUser = {
  id: string;
  fullName: string;
  login: string;
  role: { code: RoleCode; name: string };
  permissions: Permission[];
};

export type MeResponse = { user: SessionUser; csrfToken: string };

export type UserRow = {
  id: string;
  fullName: string;
  login: string;
  phone: string | null;
  role: { code: RoleCode; name: string };
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AuditLogRow = {
  id: string;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  result: "success" | "failure" | "denied";
  before: unknown;
  after: unknown;
  ip: string | null;
};

export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

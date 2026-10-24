import type { ZodType, z } from "zod";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, "unauthorized", "Tizimga kiring");
export const forbidden = () => new AppError(403, "forbidden", "Bu amal uchun ruxsatingiz yo'q");
export const notFound = (what = "Yozuv") => new AppError(404, "not_found", `${what} topilmadi`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);

/** Validates untrusted input; failures become a 400 with field-level issues. */
export function parseInput<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      "validation_error",
      "Ma'lumotlar noto'g'ri kiritilgan",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

/** Postgres unique violation, optionally on a named constraint or index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint_name?: string } })?.cause ?? err;
  const pg = cause as { code?: string; constraint_name?: string };
  return pg?.code === "23505" && (!constraint || pg.constraint_name === constraint);
}

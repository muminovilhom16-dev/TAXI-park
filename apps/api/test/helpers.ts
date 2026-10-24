import { eq, sql } from "drizzle-orm";
import type { RoleCode } from "@taxi/shared";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createDb, type Db } from "../src/db/client.js";
import { bootstrapReferenceData } from "../src/db/bootstrap.js";
import { roles, users } from "../src/db/schema/index.js";
import type { Env } from "../src/env.js";
import { TEST_DATABASE_URL, testEnv } from "./env.js";

export const PASSWORD = "test-parol-123";

export async function setupTestApp(envOverrides: Partial<Env> = {}) {
  const { db, close } = createDb(TEST_DATABASE_URL, { max: 25 });
  const env: Env = { ...testEnv(), ...envOverrides };
  const app = await buildApp({ db, env });
  await app.ready();
  return {
    app,
    db,
    async teardown() {
      await app.close();
      await close();
    },
  };
}

/** Empties every table, including append-only ones (TRUNCATE skips row triggers). */
export async function resetDb(db: Db) {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  await bootstrapReferenceData(db);
}

let hashCache: Promise<string> | undefined;

export async function createUser(db: Db, role: RoleCode, login: string = role, opts: { isActive?: boolean } = {}) {
  hashCache ??= hashPassword(PASSWORD);
  const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, role));
  const [u] = await db
    .insert(users)
    .values({
      login,
      fullName: `Test ${login}`,
      passwordHash: await hashCache,
      roleId: r!.id,
      isActive: opts.isActive ?? true,
    })
    .returning({ id: users.id });
  return u!.id;
}

type App = Awaited<ReturnType<typeof setupTestApp>>["app"];

export type Session = { cookie: string; csrf: string };

export async function login(app: App, loginName: string, password = PASSWORD): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: loginName, password } });
  if (res.statusCode !== 200) throw new Error(`login ${loginName} failed: ${res.statusCode} ${res.body}`);
  const setCookie = res.cookies.find((c) => c.name === "taxi_sid");
  const cookie = `taxi_sid=${setCookie!.value}`;
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  return { cookie, csrf: me.json().csrfToken };
}

/** Request helper that sends the session cookie and CSRF header. */
export function as(app: App, s: Session) {
  const headers = { cookie: s.cookie, "x-csrf-token": s.csrf };
  return {
    get: (url: string) => app.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => app.inject({ method: "POST", url, headers, payload: payload ?? {} }),
    patch: (url: string, payload: object) => app.inject({ method: "PATCH", url, headers, payload }),
  };
}

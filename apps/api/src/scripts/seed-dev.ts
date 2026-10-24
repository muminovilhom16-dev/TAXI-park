// Development-only demo data. Refuses to run against production.
import { eq } from "drizzle-orm";
import type { RoleCode } from "@taxi/shared";
import { hashPassword } from "../auth/password.js";
import { createDb } from "../db/client.js";
import { aggregators, roles, users } from "../db/schema/index.js";
import { loadEnv } from "../env.js";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("seed-dev refuses to run with NODE_ENV=production");
  process.exit(1);
}

const DEMO_PASSWORD = "demo-parol-123";
const demoUsers: { login: string; fullName: string; role: RoleCode }[] = [
  { login: "owner", fullName: "Demo Egasi", role: "owner" },
  { login: "admin", fullName: "Demo Administrator", role: "admin" },
  { login: "manager", fullName: "Demo Menejer", role: "manager" },
  { login: "accountant", fullName: "Demo Buxgalter", role: "accountant" },
  { login: "operator", fullName: "Demo Operator", role: "operator" },
];

const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
try {
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const u of demoUsers) {
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, u.role));
    await db
      .insert(users)
      .values({ login: u.login, fullName: u.fullName, passwordHash: hash, roleId: role!.id })
      .onConflictDoNothing();
  }
  // The money flow model stays unconfirmed: it is a business fact, not demo data.
  await db.insert(aggregators).values({ code: "demo", name: "Demo agregator" }).onConflictDoNothing();
  console.log(`Demo users: ${demoUsers.map((u) => u.login).join(", ")} / password: ${DEMO_PASSWORD}`);
} finally {
  await close();
}

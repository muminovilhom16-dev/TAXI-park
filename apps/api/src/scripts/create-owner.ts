// Creates the first owner account in any environment:
//   pnpm create-owner -- --login owner --name "Ism Familiya"
// The password is read from OWNER_PASSWORD or prompted, never passed as an argument.
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { loginNameSchema, passwordSchema } from "@taxi/shared";
import { hashPassword } from "../auth/password.js";
import { createDb } from "../db/client.js";
import { roles, users } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { loadEnv } from "../env.js";

const { values } = parseArgs({
  options: { login: { type: "string" }, name: { type: "string" } },
  allowPositionals: true,
});
const login = loginNameSchema.parse(values.login);
const fullName = (values.name ?? "").trim();
if (fullName.length < 2) throw new Error("--name is required");

let password = process.env.OWNER_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Password (min 10 chars): ");
  rl.close();
}
passwordSchema.parse(password);

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
try {
  const [owner] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, "owner"));
  if (!owner) throw new Error("Run migrations first: the owner role does not exist");
  const [row] = await db
    .insert(users)
    .values({ fullName, login, passwordHash: await hashPassword(password), roleId: owner.id })
    .returning({ id: users.id });
  await writeAudit(db, null, {
    action: "user.create",
    entityType: "user",
    entityId: row!.id,
    actorUserId: null,
    after: { login, fullName, role: "owner", via: "create-owner script" },
  });
  console.log(`Owner "${login}" created.`);
} finally {
  await close();
}

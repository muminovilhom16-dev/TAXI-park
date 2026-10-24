import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { TEST_DATABASE_URL } from "./env.js";

// Rebuilds the test database from the migrations on every run, so the
// migrations themselves are exercised by CI.
export default async function setup() {
  if (!/test/.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error(`Refusing to wipe a database whose name does not contain "test": ${TEST_DATABASE_URL}`);
  }
  const { db, close } = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
  } finally {
    await close();
  }
}

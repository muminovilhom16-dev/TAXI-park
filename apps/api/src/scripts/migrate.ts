import { createDb } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { loadEnv } from "../env.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
try {
  await runMigrations(db);
  console.log("Migrations applied and reference data is up to date.");
} finally {
  await close();
}

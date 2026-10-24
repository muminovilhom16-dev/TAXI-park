import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./client.js";
import { bootstrapReferenceData } from "./bootstrap.js";

// apps/api/drizzle, seen from src/db in dev and from dist/ in production.
function defaultMigrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = [path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")].find((dir) =>
    existsSync(path.join(dir, "meta", "_journal.json")),
  );
  if (!found) throw new Error("Migrations folder not found; set MIGRATIONS_DIR");
  return found;
}

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? defaultMigrationsFolder() });
  await bootstrapReferenceData(db);
}

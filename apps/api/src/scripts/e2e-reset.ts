// Recreates the browser-test database from scratch. Refuses any database whose
// name does not contain "e2e", so it can never wipe real data.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const target = new URL(url);
const name = target.pathname.slice(1);
if (!/e2e/.test(name) || !/^[a-z0-9_]+$/.test(name)) {
  console.error(`Refusing to reset a database whose name does not contain "e2e": ${name}`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = "/postgres";
const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
try {
  await sql.unsafe(`drop database if exists ${name} with (force)`);
  await sql.unsafe(`create database ${name}`);
  console.log(`Recreated ${name}`);
} finally {
  await sql.end();
}

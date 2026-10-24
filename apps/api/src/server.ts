import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { runScheduledAccrual } from "./services/finance.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const app = await buildApp({ db, env });

const purge = setInterval(() => {
  purgeExpiredSessions(db).catch((err) => app.log.error(err, "session purge failed"));
}, 60 * 60_000);

const accrue = () =>
  runScheduledAccrual(db)
    .then((n) => n > 0 && app.log.info({ charged: n }, "subscription accrued"))
    .catch((err) => app.log.error(err, "subscription accrual failed"));
const accrual = setInterval(accrue, 60 * 60_000);

const shutdown = async () => {
  clearInterval(purge);
  clearInterval(accrual);
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: env.API_HOST, port: env.API_PORT });
void accrue();

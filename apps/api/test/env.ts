import { loadEnv } from "../src/env.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://taxi:taxi@localhost:5432/taxi_test";

export const testEnv = () =>
  loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    WEB_ORIGIN: "http://localhost:5173",
    LOGIN_RATE_LIMIT_PER_MINUTE: "1000",
  });

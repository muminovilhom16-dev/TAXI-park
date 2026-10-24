import { defineConfig, devices } from "@playwright/test";

// Browser tests run against a real API and a throwaway database whose name
// must contain "e2e"; it is dropped and rebuilt on every run.
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://taxi:taxi@localhost:5432/taxi_e2e";
const API_PORT = 3100;
const WEB_PORT = 5174;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: WEB_ORIGIN, trace: "retain-on-failure", locale: "uz-UZ" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "pnpm --filter @taxi/api e2e:server",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        WEB_ORIGIN,
        LOGIN_RATE_LIMIT_PER_MINUTE: "1000",
      },
    },
    {
      command: `vite --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

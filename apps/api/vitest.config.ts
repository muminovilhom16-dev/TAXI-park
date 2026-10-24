import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All suites share one real Postgres database, so files run one at a time.
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});

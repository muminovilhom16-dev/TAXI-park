import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", migrate: "src/scripts/migrate.ts", "create-owner": "src/scripts/create-owner.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Bundle the workspace package; keep real dependencies external.
  noExternal: ["@taxi/shared"],
});

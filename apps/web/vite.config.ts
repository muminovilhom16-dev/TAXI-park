import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    // Same-origin in dev too, so the session cookie and CSRF checks behave as in production.
    proxy: { "/api": { target: process.env.API_URL ?? "http://127.0.0.1:3000", changeOrigin: false } },
  },
});

/** Isolated visual fixture server; never loaded by the app's Vite config. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: process.cwd(),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/hooks/useAuth", replacement: path.resolve("tests/fixtures/scenarioLibraryReviewData.ts") },
      { find: "@", replacement: path.resolve("client/src") },
      { find: "@shared", replacement: path.resolve("shared") },
    ],
  },
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    // Each DB test boots an in-memory Postgres (PGlite) and migrates it; under load that can pass 10 s.
    hookTimeout: 30_000,
  },
});

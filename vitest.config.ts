import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "./apps/api/vitest.config.ts",
      "./apps/web/vitest.config.ts",
      "./packages/stellar/vitest.config.ts",
      "./packages/storage/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },
  },
});

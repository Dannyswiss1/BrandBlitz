import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineProject } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      "@brandblitz/stellar": path.resolve(projectRoot, "../../packages/stellar/src"),
    },
  },
  test: {
    name: "@brandblitz/deposit-monitor",
    root: projectRoot,
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(projectRoot, "src/test-setup.ts")],
    include: ["src/**/*.test.ts"],
  },
});

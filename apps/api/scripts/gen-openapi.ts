/**
 * Generate `docs/openapi.yml` from the in-process zod-to-openapi registry (#143).
 *
 * Walks every `*.openapi.ts` module via `loadAllRouteSchemas()` to
 * trigger registration, then asks the registry to emit OpenAPI 3.1.
 *
 * Run locally:
 *   pnpm --filter @brandblitz/api gen:openapi
 *
 * CI uses this same script to detect drift — regenerates the spec
 * and diffs against the committed `docs/openapi.yml`. A non-zero
 * diff fails the workflow.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { stringify as stringifyYaml } from "yaml";

import { registry, loadAllRouteSchemas } from "../src/lib/openapi-registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OUTPUT_PATH = resolve(REPO_ROOT, "docs", "openapi.yml");

async function main(): Promise<void> {
  await loadAllRouteSchemas();

  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "BrandBlitz API",
      version: process.env.npm_package_version || "0.1.0",
      description: [
        "BrandBlitz HTTP API.",
        "",
        "Spec is generated from zod schemas at `apps/api/src/routes/openapi/*.openapi.ts`",
        "via `pnpm --filter @brandblitz/api gen:openapi`. CI fails the build when the",
        "generated spec drifts from the committed `docs/openapi.yml`, so every route",
        "schema change must be accompanied by a regenerated spec in the same commit.",
      ].join("\n"),
    },
    servers: [
      { url: "https://api.brandblitz.app", description: "Production" },
      { url: "http://localhost:4000", description: "Local dev" },
    ],
  });

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, stringifyYaml(document), "utf8");
  process.stdout.write(`wrote ${OUTPUT_PATH}\n`);
}

void main().catch((err) => {
  process.stderr.write(`gen-openapi failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});

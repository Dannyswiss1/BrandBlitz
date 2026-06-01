import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configSchema } from "../apps/api/src/lib/config-schema";

function parseEnvExample(contents: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

const envExamplePath = resolve(process.cwd(), ".env.example");
const envExample = parseEnvExample(readFileSync(envExamplePath, "utf8"));
const result = configSchema.safeParse({
  ...envExample,
  HOT_WALLET_SECRET:
    envExample.HOT_WALLET_SECRET ?? envExample.STELLAR_HOT_WALLET_SECRET,
  S3_ACCESS_KEY_ID: envExample.S3_ACCESS_KEY_ID ?? envExample.S3_ACCESS_KEY,
  S3_SECRET_ACCESS_KEY:
    envExample.S3_SECRET_ACCESS_KEY ?? envExample.S3_SECRET_KEY,
  TWILIO_SERVICE_SID:
    envExample.TWILIO_SERVICE_SID ?? envExample.TWILIO_VERIFY_SERVICE_SID,
});

if (!result.success) {
  const missing = result.error.issues
    .filter((issue) => {
      const typedIssue = issue as { code: string; received?: string };
      return (
        typedIssue.code === "invalid_type" &&
        typedIssue.received === "undefined"
      );
    })
    .map((issue) => issue.path.join("."));

  const invalid = result.error.issues
    .filter((issue) => {
      const typedIssue = issue as { code: string; received?: string };
      return (
        typedIssue.code !== "invalid_type" ||
        typedIssue.received !== "undefined"
      );
    })
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  console.error(
    "❌ .env.example is out of sync with apps/api/src/lib/config-schema.ts",
  );
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
  }
  if (invalid.length > 0) {
    console.error(`Invalid env vars: ${invalid.join("; ")}`);
  }
  process.exit(1);
}

console.log("✅ .env.example matches the API config schema");

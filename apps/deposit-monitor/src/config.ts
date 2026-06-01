import { z } from "zod";
import "dotenv/config";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  REDIS_URL: z.string().url(),
  STELLAR_NETWORK: z.enum(["testnet", "public"]).default("testnet"),
  HOT_WALLET_PUBLIC_KEY: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  // WEB_URL is the internal URL of the API service in docker-compose, or localhost in dev
  API_URL: z.string().url().default("http://api:3001"),
  DEPOSIT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
});

export const config = configSchema.parse({
  ...process.env,
  API_URL: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL,
});

export type Config = z.infer<typeof configSchema>;

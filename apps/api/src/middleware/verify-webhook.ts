import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { query } from "../db/index";

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

interface WebhookSecret {
  secret: string;
  expiresAt?: string;
}

async function getWebhookSecrets(): Promise<{ current: string; pending?: string }> {
  const result = await query<{ key: string; value: WebhookSecret }>(
    `SELECT key, value FROM app_config WHERE key IN ('webhook_secret_current', 'webhook_secret_pending')`
  );

  const secrets: { current: string; pending?: string } = { current: "" };

  for (const row of result.rows) {
    if (row.key === "webhook_secret_current") {
      secrets.current = row.value.secret;
    } else if (row.key === "webhook_secret_pending") {
      // Check if pending secret has expired
      if (row.value.expiresAt && new Date(row.value.expiresAt) > new Date()) {
        secrets.pending = row.value.secret;
      }
    }
  }

  // Fallback to environment variable if no current secret in DB
  if (!secrets.current && process.env.WEBHOOK_SECRET) {
    secrets.current = process.env.WEBHOOK_SECRET;
  }

  return secrets;
}

export function signWebhookPayload(payload: string | Buffer, timestamp: number, secret: string): string {
  const body = typeof payload === "string" ? payload : payload.toString("utf8");
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${timestamp}.${body}`);
  return hmac.digest("hex");
}

export async function verifyWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secrets = await getWebhookSecrets();

  if (!secrets.current) {
    logger.error("No webhook secret configured");
    res.status(500).json({ error: "Webhook verification misconfigured" });
    return;
  }

  const signatureHeader = req.headers["x-webhook-signature"];
  if (typeof signatureHeader !== "string") {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const [algorithm, providedHex] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !/^[a-fA-F0-9]{64}$/.test(providedHex)) {
    res.status(401).json({ error: "Invalid signature format" });
    return;
  }

  const timestampHeader = req.headers["x-webhook-timestamp"];
  if (typeof timestampHeader !== "string") {
    res.status(400).json({ error: "Missing timestamp" });
    return;
  }

  const webhookId = req.headers["x-webhook-id"];
  if (typeof webhookId !== "string" || webhookId.trim() === "") {
    res.status(400).json({ error: "Missing webhook id" });
    return;
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    res.status(400).json({ error: "Invalid timestamp" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    res.status(400).json({ error: "Stale webhook request" });
    return;
  }

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) {
    res.status(500).json({ error: "Raw webhook payload unavailable" });
    return;
  }

  const providedBuffer = Buffer.from(providedHex, "hex");

  // Try validating against current secret
  const currentSignature = signWebhookPayload(rawBody, timestamp, secrets.current);
  const currentBuffer = Buffer.from(currentSignature, "hex");

  if (
    currentBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(currentBuffer, providedBuffer)
  ) {
    // Valid with current secret
  } else if (secrets.pending) {
    // Try validating against pending secret
    const pendingSignature = signWebhookPayload(rawBody, timestamp, secrets.pending);
    const pendingBuffer = Buffer.from(pendingSignature, "hex");

    if (
      pendingBuffer.length !== providedBuffer.length ||
      !crypto.timingSafeEqual(pendingBuffer, providedBuffer)
    ) {
      // Neither current nor pending secret matched
      logger.warn("Invalid webhook signature", { webhookId });
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    // Valid with pending secret
  } else {
    // No pending secret and current didn't match
    logger.warn("Invalid webhook signature", { webhookId });
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const redisKey = `webhook:id:${webhookId}`;
  const stored = await redis.set(redisKey, "1", "EX", 600, "NX");
  if (stored === null) {
    logger.warn("Duplicate webhook id rejected", { webhookId });
    res.status(200).json({ status: "duplicate" });
    return;
  }

  next();
}

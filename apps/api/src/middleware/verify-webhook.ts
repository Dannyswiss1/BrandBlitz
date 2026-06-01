import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { config } from "../lib/config";

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function signWebhookPayload(payload: string | Buffer, timestamp: number): string {
  const body = typeof payload === "string" ? payload : payload.toString("utf8");
  const hmac = crypto.createHmac("sha256", config.WEBHOOK_SECRET);
  hmac.update(`${timestamp}.${body}`);
  return hmac.digest("hex");
}

export async function verifyWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secret = req.headers["x-webhook-secret"];
  const secretBuf = Buffer.from(typeof secret === "string" ? secret : "");
  const expectedSecretBuf = Buffer.from(config.WEBHOOK_SECRET);
  if (
    secretBuf.length !== expectedSecretBuf.length ||
    !crypto.timingSafeEqual(secretBuf, expectedSecretBuf)
  ) {
    res.status(401).json({ error: "Unauthorized" });
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

  const expectedSignature = signWebhookPayload(rawBody, timestamp);
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const providedBuffer = Buffer.from(providedHex, "hex");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
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

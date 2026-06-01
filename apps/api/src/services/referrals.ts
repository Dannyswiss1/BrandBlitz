import crypto from "node:crypto";
import type { Request } from "express";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { computeFingerprint } from "../lib/fingerprint";
import { createError } from "../middleware/error";
import {
  findUserById,
  findUserByReferralCode,
  getUserReferralCode,
  setUserReferralCode,
} from "../db/queries/users";
import {
  createReferral,
  countReferralConversions,
  countReferralInvites,
  findReferralByReferrerAndReferred,
  findReferralByReferredId,
  markReferralRewarded,
} from "../db/queries/referrals";
import {
  createReferralPayout,
  getReferralPayoutTotalsForUser,
} from "../db/queries/referral-payouts";
import { enqueueReferralBonus } from "../queues/referral-bonus.queue";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const PENDING_REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60;
const REFERRAL_OWNER_TTL_SECONDS = 365 * 24 * 60 * 60;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}

function fingerprintKey(fingerprint: string): string {
  return `referral:fingerprint:${fingerprint}`;
}

function pendingReferralKey(fingerprint: string): string {
  return `referral:pending:${fingerprint}`;
}

export function buildReferralUrl(code: string): string {
  return `?ref=${encodeURIComponent(code)}`;
}

async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }

    const existing = await findUserByReferralCode(code);
    if (!existing) {
      return code;
    }
  }

  throw new Error("Unable to generate unique referral code");
}

export async function ensureUserReferralCode(userId: string): Promise<string> {
  const existing = await getUserReferralCode(userId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = await generateUniqueReferralCode();
    try {
      await setUserReferralCode(userId, code);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        continue;
      }
      throw error;
    }

    const updated = await getUserReferralCode(userId);
    if (updated) return updated;
  }

  throw new Error("Unable to assign referral code");
}

export async function recordReferralFingerprint(
  userId: string,
  req: Request,
): Promise<void> {
  const fingerprint = computeFingerprint({
    visitorId: readRequestHeader(req, "x-visitor-id"),
    deviceId: readRequestHeader(req, "x-device-id"),
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  await redis.set(
    fingerprintKey(fingerprint),
    userId,
    "EX",
    REFERRAL_OWNER_TTL_SECONDS,
  );
}

export async function consumePendingReferralAttribution(
  userId: string,
  req: Request,
): Promise<void> {
  const codeFromRequest = readReferralCode(req);
  const fingerprint = computeFingerprint({
    visitorId: readRequestHeader(req, "x-visitor-id"),
    deviceId: readRequestHeader(req, "x-device-id"),
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const code = normalizeCode(
    codeFromRequest ?? (await redis.get(pendingReferralKey(fingerprint))) ?? "",
  );

  if (!code || !isValidCode(code)) {
    await recordReferralFingerprint(userId, req);
    return;
  }

  const referrer = await findUserByReferralCode(code);
  if (!referrer) {
    await recordReferralFingerprint(userId, req);
    return;
  }

  if (referrer.id === userId) {
    throw createError("Self-referrals are not allowed", 409);
  }

  const existingFingerprintOwner = await redis.get(fingerprintKey(fingerprint));
  if (existingFingerprintOwner && existingFingerprintOwner !== userId) {
    throw createError("Referral attribution rejected for this device", 409);
  }

  const reverseReferral = await findReferralByReferrerAndReferred(
    userId,
    referrer.id,
  );
  if (reverseReferral) {
    throw createError("Referral cycle detected", 409);
  }

  const existingReferral = await findReferralByReferredId(userId);
  if (existingReferral) {
    await recordReferralFingerprint(userId, req);
    return;
  }

  await createReferral(referrer.id, userId);
  await redis.del(pendingReferralKey(fingerprint));
  await recordReferralFingerprint(userId, req);
}

export async function getReferralStats(userId: string): Promise<{
  referralCode: string | null;
  invitesSent: number;
  conversions: number;
  totalEarnedStroops: bigint;
}> {
  const [referralCode, invitesSent, conversions, totals] = await Promise.all([
    getUserReferralCode(userId),
    countReferralInvites(userId),
    countReferralConversions(userId),
    getReferralPayoutTotalsForUser(userId),
  ]);

  return {
    referralCode,
    invitesSent,
    conversions,
    totalEarnedStroops: totals.referrerStroops + totals.referredStroops,
  };
}

export async function queueReferralBonusForPayout(params: {
  referredUserId: string;
  challengeId?: string | null;
  referralWinAmountStroops: bigint;
}): Promise<void> {
  const referral = await findReferralByReferredId(params.referredUserId);
  if (!referral || referral.rewarded) return;

  const [referrerUser, referredUser] = await Promise.all([
    findUserById(referral.referrer_id),
    findUserById(referral.referred_id),
  ]);

  const referrerAddress = resolvePayoutAddress(referrerUser);
  const referredAddress = resolvePayoutAddress(referredUser);

  if (!referrerAddress || !referredAddress) {
    return;
  }

  const refereeAmount = 10_000_000n;
  const referrerAmount = params.referralWinAmountStroops / 10n;
  const cappedReferrerAmount =
    referrerAmount > 50_000_000n ? 50_000_000n : referrerAmount;

  if (cappedReferrerAmount < 1n || refereeAmount < 1n) return;

  const payout = await createReferralPayout({
    referralId: referral.id,
    challengeId: params.challengeId ?? null,
    referrerId: referral.referrer_id,
    referredId: referral.referred_id,
    referrerStellarAddress: referrerAddress,
    referredStellarAddress: referredAddress,
    referrerAmountStroops: cappedReferrerAmount,
    referredAmountStroops: refereeAmount,
  });

  if (!payout) return;
  if (payout.status !== "pending") return;

  try {
    await markReferralRewarded(referral.id);
    await enqueueReferralBonus(payout.id);
  } catch (error) {
    logger.error("Failed to enqueue referral bonus payout", {
      referralId: referral.id,
      referralPayoutId: payout.id,
      error: (error as Error).message,
    });
  }
}

function readRequestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function readReferralCode(req: Request): string | undefined {
  const queryRef = req.query.ref;
  if (typeof queryRef === "string" && queryRef.trim()) {
    return queryRef.trim();
  }

  const cookieRef = req.cookies?.ref;
  if (typeof cookieRef === "string" && cookieRef.trim()) {
    return cookieRef.trim();
  }

  return undefined;
}

function resolvePayoutAddress(
  user: Awaited<ReturnType<typeof findUserById>>,
): string | null {
  if (!user) return null;
  const embedded = user.embedded_wallet_address?.trim();
  const stellar = user.stellar_address?.trim();
  return embedded || stellar || null;
}

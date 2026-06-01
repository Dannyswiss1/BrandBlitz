import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  findUserById,
  findUserByPhoneHash,
  markPhoneVerified,
  updateUserWallet,
  getUserPublicProfileByUsername,
} from "../db/queries/users";
import { getReferralStats } from "../services/referrals";
import { stroopsToUsdc } from "../lib/usdc";
import { getStreak, repairStreak } from "../services/streaks";
import {
  sendVerificationCode,
  checkVerificationCode,
  hashPhoneNumber,
  normalizePhoneNumber,
} from "../services/phone";
import { authenticate } from "../middleware/authenticate";
import { createError } from "../middleware/error";
import { redis } from "../lib/redis";
import { apiLimiter } from "../middleware/rate-limit";

const router: Router = Router();

/**
 * GET /users/me
 * Full profile of the authenticated user.
 */
router.get("/me", authenticate, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) throw createError("User not found", 404);

  const safeUser = {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    username: user.username,
    avatar_url: user.avatar_url,
    stellar_address: user.stellar_address,
    embedded_wallet_address: user.embedded_wallet_address,
    phone_verified: user.phone_verified,
    age_verified: user.age_verified,
    kyc_complete: user.kyc_complete,
    state_code: user.state_code,
    streak: user.streak,
    last_play_day: user.last_play_day,
    streak_repairs_this_month: user.streak_repairs_this_month,
    streak_repair_available: user.streak_repair_available,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };

  res.json({ user: safeUser });
});

router.get("/me/streak", authenticate, async (req, res) => {
  const streak = await getStreak(req.user!.sub).catch(() => null);
  if (!streak) throw createError("User not found", 404);

  res.json(streak);
});

router.get("/:id/streak", authenticate, async (req, res) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  if (id !== req.user!.sub) throw createError("Forbidden", 403, "FORBIDDEN");

  const streak = await getStreak(id).catch(() => null);
  if (!streak) throw createError("User not found", 404);

  res.json({
    streak: streak.streak,
    last_play_day: streak.lastPlayDay,
    repair_available: streak.repairAvailable,
  });
});

router.get("/me/referrals/stats", authenticate, async (req, res) => {
  const stats = await getReferralStats(req.user!.sub);

  res.json({
    referralCode: stats.referralCode,
    invitesSent: stats.invitesSent,
    conversions: stats.conversions,
    totalEarned: stroopsToUsdc(stats.totalEarnedStroops),
    totalEarnedUsdc: stroopsToUsdc(stats.totalEarnedStroops),
  });
});

router.post("/streaks/repair", authenticate, async (req, res) => {
  const repaired = await repairStreak(req.user!.sub);
  if (!repaired) {
    throw createError("Monthly streak repair already used", 409, "STREAK_REPAIR_LIMIT");
  }

  res.json(repaired);
});

/**
 * GET /users/profile/:username
 * Public profile — display name, stats. No auth required.
 */
router.get("/profile/:username", apiLimiter, async (req, res) => {
  const { username } = z.object({ username: z.string() }).parse(req.params);

  const user = await getUserPublicProfileByUsername(username);
  if (!user) throw createError("User not found", 404);

  res.json({
    user: {
      displayName: user.display_name,
      username: user.username,
      league: user.league,
      totalEarned: user.total_earned_usdc,
      totalChallenges: user.challenges_played,
      avatarUrl: user.avatar_url,
      streak: user.streak,
    },
  });
});

/**
 * PATCH /users/me/wallet
 */
router.patch("/me/wallet", authenticate, async (req, res) => {
  const { stellarAddress } = z
    .object({ stellarAddress: z.string().min(56).max(70) })
    .parse(req.body);

  await updateUserWallet(req.user!.sub, stellarAddress);
  res.json({ success: true });
});

/**
 * POST /users/me/phone/send
 * Send SMS verification code via Twilio.
 */
router.post("/me/phone/send", authenticate, async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(1) }).parse(req.body);
  const normalizedPhone = normalizePhoneNumber(phone);

  // Rate limit: 3 sends per phone per 5 minutes
  const key = `phone:send:${normalizedPhone}`;
  const sends = await redis.incr(key);
  if (sends === 1) await redis.expire(key, 300);
  if (sends > 3) throw createError("Too many verification attempts", 429);

  await sendVerificationCode(normalizedPhone);
  res.json({ success: true });
});

/**
 * POST /users/me/phone/verify
 * Confirm SMS verification code. Marks phone as verified.
 */
router.post("/me/phone/verify", authenticate, async (req, res) => {
  const { phone, code } = z
    .object({ phone: z.string(), code: z.string().length(6) })
    .parse(req.body);

  const normalizedPhone = normalizePhoneNumber(phone);
  const phoneHash = hashPhoneNumber(normalizedPhone);

  const existingUser = await findUserByPhoneHash(phoneHash);
  if (existingUser && existingUser.id !== req.user!.sub) {
    throw createError("Phone number already associated with another account", 409);
  }

  const approved = await checkVerificationCode(normalizedPhone, code);
  if (!approved) {
    const attemptsKey = `phone:verify:${phoneHash}`;
    const attempts = await redis.incr(attemptsKey);
    if (attempts === 1) await redis.expire(attemptsKey, 300);
    throw createError("Invalid verification code", 400);
  }

  const existingKey = `phone:hash:${phoneHash}`;
  await markPhoneVerified(req.user!.sub, phoneHash);
  await redis.set(existingKey, req.user!.sub, "EX", 86400 * 365);
  await redis.del(`phone:verify:${phoneHash}`);

  res.json({ success: true });
});

export default router;

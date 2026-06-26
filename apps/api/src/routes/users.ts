import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  findUserById,
  findUserByPhoneHash,
  markPhoneVerified,
  updateUserWallet,
  updateUserProfile,
  getUserPublicProfileByUsername,
} from "../db/queries/users";
import { getReferralStats } from "../services/referrals";
import { stroopsToUsdc } from "../lib/usdc";
import { getStreak, repairStreak } from "../services/streaks";
import {
  sendVerificationCode,
  hashPhoneNumber,
  normalizePhoneNumber,
  verifyOtpWithBruteForceProtection,
} from "../services/phone";
import { authenticate } from "../middleware/authenticate";
import { createError } from "../middleware/error";
import { redis } from "../lib/redis";
import { apiLimiter, phoneRateLimit } from "../middleware/rate-limit";
import { getBadgesForUser } from "../services/badges";
import { config } from "../lib/config";

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
 * Returns a redirect field if the username has been renamed.
 */
router.get("/profile/:username", apiLimiter, async (req, res) => {
  const { username } = z.object({ username: z.string() }).parse(req.params);

  // Check for username redirect first
  const redirectTarget = await redis.get(`username:redirect:${username}`);
  if (redirectTarget) {
    res.json({ redirect: redirectTarget });
    return;
  }

  const user = await getUserPublicProfileByUsername(username);
  if (!user) throw createError("User not found", 404);

  const isOwner = req.user?.sub === user.id;

  res.json({
    user: {
      userId: isOwner ? user.id : undefined,
      displayName: user.display_name,
      username: user.username,
      league: user.league,
      totalEarned: user.total_earned_usdc,
      totalChallenges: user.challenges_played,
      avatarUrl: user.avatar_url,
      streak: user.streak,
      createdAt: user.created_at,
      isOwner,
    },
  });
});

/**
 * GET /users/:id/badges
 * Returns all 8 badge definitions merged with the user's earned status.
 * Earned badges include awarded_at; locked badges are included with earned=false.
 */
router.get("/:id/badges", authenticate, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  if (id !== req.user!.sub) throw createError("Forbidden", 403, "FORBIDDEN");

  const badges = await getBadgesForUser(id);
  res.json({ badges });
});

/**
 * PATCH /users/me/wallet
 */
router.patch("/me/wallet", authenticate, async (req, res) => {
  const { stellarAddress } = z
    .object({ stellarAddress: z.string().min(56).max(70) })
    .strict()
    .parse(req.body);

  await updateUserWallet(req.user!.sub, stellarAddress);
  res.json({ success: true });
});

/**
 * PATCH /users/me/profile
 * Update display name and/or username. Triggers cache revalidation
 * so Next.js pages reflect the new values immediately.
 */
router.patch("/me/profile", authenticate, async (req, res) => {
  const body = z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      username: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[a-z0-9-]+$/, "Username may only contain lowercase letters, numbers, and hyphens")
        .optional(),
    })
    .parse(req.body);

  if (!body.displayName && !body.username) {
    throw createError("Nothing to update", 400);
  }

  const { oldUsername, newUsername } = await updateUserProfile(req.user!.sub, body);

  // Store redirect for old username (so visiting /profile/<old> redirects to new URL)
  if (oldUsername && oldUsername !== newUsername) {
    await redis.set(`username:redirect:${oldUsername}`, newUsername, "EX", 86400 * 365);
  }

  // Trigger Next.js cache revalidation so profile pages reflect the new data
  const revalidatePaths = [
    `/profile/${oldUsername}`,
    `/profile/${newUsername}`,
  ];

  try {
    await fetch(`${config.WEB_URL}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.WEBHOOK_SECRET,
        paths: revalidatePaths,
        tags: [`profile-${oldUsername}`, `profile-${newUsername}`],
      }),
    });
  } catch {
    // Non-critical — stale cache will eventually expire
    console.warn("Failed to trigger cache revalidation for profile update");
  }

  res.json({ success: true, oldUsername, newUsername });
});

/**
 * POST /users/me/phone/send
 * Send SMS verification code via Twilio.
 */
router.post("/me/phone/send", authenticate, phoneRateLimit, async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(1) }).parse(req.body);
  const normalizedPhone = normalizePhoneNumber(phone);

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

  // verifyOtpWithBruteForceProtection throws 429 (with retryAfter) on lockout,
  // 400 on wrong code, and nothing on success.
  try {
    await verifyOtpWithBruteForceProtection(normalizedPhone, code);
  } catch (err: any) {
    if (err.statusCode === 429 && err.retryAfter != null) {
      res.set("Retry-After", String(err.retryAfter));
    }
    throw err;
  }

  const existingKey = `phone:hash:${phoneHash}`;
  await markPhoneVerified(req.user!.sub, phoneHash);
  await redis.set(existingKey, req.user!.sub, "EX", 86400 * 365);

  res.json({ success: true });
});

export default router;

import { Router } from "express";
import { z } from "zod";
import { getChallengeById, getChallengeQuestions } from "../db/queries/challenges";
import {
  getSession,
  markWarmupStarted,
  markWarmupCompleted,
  markChallengeStarted,
  recordRoundScore,
  finishSession,
  storeSessionHmac,
} from "../db/queries/sessions";
import { calculateRoundScore, validateAnswer } from "../services/scoring";
import { authenticate } from "../middleware/authenticate";
import { requireActiveUser } from "../middleware/require-active-user";
import {
  enforceOneSessionPerChallenge,
  validateReactionTime,
  validateDeviceFingerprint,
} from "../middleware/anti-cheat";
import { createError } from "../middleware/error";
import { challengeStartLimiter } from "../middleware/rate-limit";
import { redis } from "../lib/redis";
import { computeSessionHmac } from "../lib/integrity";
import { updateStreak } from "../services/streaks";
import { WARMUP_MIN_SECONDS } from "@brandblitz/stellar";
import { tokenRevocationKey, tokenTtlSeconds } from "../middleware/authenticate";

const router = Router();

function bearerToken(req: { headers: { authorization?: string } }): string | null {
  const authHeader = req.headers.authorization;
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

async function revokeSessionToken(sessionId: string, token: string, exp: number): Promise<void> {
  await redis.del(`session-token:${sessionId}`);
  await redis.del(`session:start:${sessionId}`);
  await redis.set(
    tokenRevocationKey(token),
    "1",
    "EX",
    tokenTtlSeconds({ sub: "", email: "", iat: 0, exp })
  );
}

const AnswerSchema = z.object({
  selectedOption: z.enum(["A", "B", "C", "D"]).nullable(),
  reactionTimeMs: z.number().int().min(0),
});

/**
 * POST /sessions/:challengeId/warmup-start
 * Begin the warm-up phase. Records start time server-side.
 * Uses DB UNIQUE constraint to atomically create the session (no race).
 */
router.post(
  "/:challengeId/warmup-start",
  authenticate,
  requireActiveUser,
  validateDeviceFingerprint,
  enforceOneSessionPerChallenge,
  async (req, res) => {
    const challengeId = String(req.params.challengeId);
    const challenge = await getChallengeById(challengeId);
    if (!challenge || challenge.status !== "active") {
      throw createError("Challenge not available", 404);
    }

    const session = (req as any).session;
    if (!session) throw createError("Session not found", 404);

    await markWarmupStarted(session.id);

    // Store warmup unlock time in Redis (server enforces minimum exposure)
    const unlockAt = Date.now() + WARMUP_MIN_SECONDS * 1000;
    await redis.set(`warmup:unlock:${session.id}`, unlockAt.toString(), "EX", 300);

    res.json({ sessionId: session.id, unlockAt });
  }
);

/**
 * POST /sessions/:challengeId/warmup-complete
 * Completes warm-up and issues a short-lived challenge token.
 * Server enforces that minimum exposure time has passed.
 */
router.post("/:challengeId/warmup-complete", authenticate, async (req, res) => {
  const challengeId = String(req.params.challengeId);
  const challenge = await getChallengeById(challengeId);
  if (!challenge) throw createError("Challenge not found", 404);

  const session = await getSession(req.user!.sub, challenge.id);
  if (!session) throw createError("Session not found", 404);
  if (session.user_id !== req.user!.sub) throw createError("Forbidden", 403);

  // Enforce server-side warmup minimum
  const unlockAt = await redis.get(`warmup:unlock:${session.id}`);
  if (unlockAt) {
    const remainingMs = parseInt(unlockAt) - Date.now();
    if (remainingMs > 0) {
      const error = createError("Warm-up minimum not yet elapsed", 400, "WARMUP_TOO_FAST");
      (error as any).remainingMs = remainingMs;
      throw error;
    }
  }

  await markWarmupCompleted(session.id);

  // Issue a short-lived challenge token (10 min TTL)
  const challengeToken = `ct:${session.id}:${Date.now()}`;
  await redis.set(`challenge-token:${challengeToken}`, session.id, "EX", 600);

  res.json({ challengeToken });
});

/**
 * POST /sessions/:challengeId/start
 * Start the challenge timer. Validates challenge token from warmup-complete.
 */
router.post(
  "/:challengeId/start",
  authenticate,
  requireActiveUser,
  challengeStartLimiter,
  async (req, res) => {
    const { challengeToken } = z.object({ challengeToken: z.string() }).parse(req.body);
    const challengeId = String(req.params.challengeId);
    const challenge = await getChallengeById(challengeId);
    if (!challenge) throw createError("Challenge not found", 404);

    // Validate challenge token
    const storedSessionId = await redis.get(`challenge-token:${challengeToken}`);
    if (!storedSessionId) throw createError("Invalid or expired challenge token", 401);

    const session = await getSession(req.user!.sub, challenge.id);
    if (!session || session.id !== storedSessionId) throw createError("Session mismatch", 403);

    await markChallengeStarted(session.id);
    await redis.del(`challenge-token:${challengeToken}`);

    // Store session start time for timing validation
    await redis.set(`session:start:${session.id}`, Date.now().toString(), "EX", 120);
    const token = bearerToken(req);
    if (token) {
      await redis.set(`session-token:${session.id}`, token, "EX", 600);
    }

    res.json({ sessionId: session.id, startsAt: new Date().toISOString() });
  }
);

/**
 * POST /sessions/:challengeId/answer/:round
 * Submit an answer for a round. Validates + scores server-side.
 * Correct answers are NEVER sent to the client.
 * Round-3 is idempotent: duplicate requests return the cached result.
 */
router.post(
  "/:challengeId/answer/:round",
  authenticate,
  validateReactionTime,
  async (req, res) => {
    const challengeId = String(req.params.challengeId);
    const round = parseInt(String(req.params.round)) as 1 | 2 | 3;
    if (![1, 2, 3].includes(round)) throw createError("Invalid round", 400);

    const body = AnswerSchema.parse(req.body);
    const challenge = await getChallengeById(challengeId);
    if (!challenge) throw createError("Challenge not found", 404);

    const session = await getSession(req.user!.sub, challenge.id);
    if (!session) throw createError("Session not found", 404);
    if (session.user_id !== req.user!.sub) throw createError("Forbidden", 403);
    if (!session.challenge_started_at) throw createError("Challenge not started", 400);

    // Edge Cases
    if (session.completed_at) throw createError("Session already completed", 409);
    if ((session as any).is_flagged || session.flagged) {
      throw createError("Session flagged for review", 403);
    }
    
    // Double answer check
    const existingScores = (session as any).scores || []; // Assume scores are joined or we need to check DB
    if (existingScores.some((s: any) => s.round === round)) {
      throw createError("Round already answered", 400);
    }
router.post("/:challengeId/answer/:round", authenticate, validateReactionTime, async (req, res) => {
  const round = parseInt(req.params.round) as 1 | 2 | 3;
  if (![1, 2, 3].includes(round)) throw createError("Invalid round", 400);

  const body = AnswerSchema.parse(req.body);
  const challenge = await getChallengeById(req.params.challengeId);
  if (!challenge) throw createError("Challenge not found", 404);

  const session = await getSession(req.user!.sub, challenge.id);
  if (!session) throw createError("Session not found", 404);
  if (session.user_id !== req.user!.sub) throw createError("Forbidden", 403);
  if (!session.challenge_started_at) throw createError("Challenge not started", 400);

  // For non-round-3, a completed session is always a hard stop
  if (session.completed_at && round !== 3) {
    throw createError("Session already completed", 409);
  }
  if (session.is_flagged) throw createError("Session flagged for review", 403);

  // Double answer check
  const existingScores = (session as any).scores || [];
  if (existingScores.some((s: any) => s.round === round)) {
    throw createError("Round already answered", 400);
  }

  // Get the server-stored question for this round
  const questions = await getChallengeQuestions(challenge.id);
  const question = questions.find((q) => q.round === round);
  if (!question) throw createError("Question not found", 404);

    // On last round — finalize the session
    if (round === 3) {
      await finishSession(session.id);
      const token = bearerToken(req);
      if (token) {
        await revokeSessionToken(session.id, token, req.user!.exp);
      }
  // Idempotent round-3 replay: return cached result if answer matches; reject if it differs
  if (session.completed_at && round === 3) {
    if (session.round_3_answer !== body.selectedOption) {
      throw createError("Answer conflict detected", 409, "CONFLICT_REPLAY");
    }
    return res.json({
      correct: validateAnswer(question, body.selectedOption),
      score: session.round_3_score,
      round: 3,
      total_score: session.total_score,
      rank: session.rank ?? null,
    });
  }

  const score = calculateRoundScore({
    selectedOption: body.selectedOption,
    correctOption: question.correct_option,
    reactionTimeMs: body.reactionTimeMs,
  });

  await recordRoundScore(session.id, round, score, body.selectedOption, body.reactionTimeMs);

  // On last round — finalize the session and stamp an integrity HMAC
  if (round === 3) {
    const completed = await finishSession(session.id);
    if (completed) {
      const hmac = computeSessionHmac(completed.id, completed.total_score, completed.completed_at!);
      if (hmac) {
        await storeSessionHmac(session.id, hmac);
      }
      if (!completed.is_practice) {
        await updateStreak(completed.user_id);
      }
    }
  }

  res.json({
    correct: validateAnswer(question, body.selectedOption),
    score,
    round,
  });
});

export default router;

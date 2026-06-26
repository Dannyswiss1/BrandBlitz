import { query } from "../index";
import { usdcToStroops } from "../../lib/usdc";
import { encodeCursor, buildCursorWhereSimple, decodeCursorSafe } from "../pagination";

export type ChallengeStatus =
  | "pending_deposit"
  | "active"
  | "ended"
  | "settled"
  | "payout_failed"
  | "cancelled"
  | "refunded";

export interface Challenge {
  id: string;
  brand_id: string;
  challenge_id: string;
  pool_amount_stroops: string;
  pool_amount_usdc: string;
  participant_count?: number;
  brand_name?: string;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  status: ChallengeStatus;
  deposit_tx_hash: string | null;
  deposit_confirmations: number;
  payout_tx_hashes: string[] | null;
  max_players: number | null;
  starts_at: string;
  ends_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ChallengeQuestion {
  id: string;
  challenge_id: string;
  round: 1 | 2 | 3;
  question_type: "which_brand" | "which_tagline" | "which_product";
  prompt_type: "logo" | "productImage1" | "tagline";
  question_text: string;
  correct_answer: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
}

export async function createChallenge(data: {
  brandId: string;
  challengeId: string;
  poolAmountUsdc: string;
  maxPlayers?: number;
  endsAt?: string;
}): Promise<Challenge> {
  const result = await query<Challenge>(
    `INSERT INTO challenges
       (brand_id, challenge_id, pool_amount_stroops, max_players, ends_at)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *, (pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc`,
    [
      data.brandId,
      data.challengeId,
      usdcToStroops(data.poolAmountUsdc),
      data.maxPlayers ?? null,
      data.endsAt ?? null,
    ]
  );
  return result.rows[0];
}

export async function getChallengeByMemo(challengeId: string): Promise<Challenge | null> {
  const result = await query<Challenge>(
    "SELECT *, (pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc FROM challenges WHERE deposit_memo = $1 AND deleted_at IS NULL",
    [challengeId]
  );
  return result.rows[0] ?? null;
}

export async function getChallengeByDepositTxHash(txHash: string): Promise<Challenge | null> {
  const result = await query<Challenge>(
    "SELECT *, (pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc FROM challenges WHERE deposit_tx_hash = $1 AND deleted_at IS NULL LIMIT 1",
    [txHash]
  );
  return result.rows[0] ?? null;
}

export async function getChallengeById(id: string): Promise<Challenge | null> {
  const result = await query<Challenge>(
    "SELECT *, (pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc FROM challenges WHERE id = $1 AND deleted_at IS NULL",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getArchivedChallengeById(id: string): Promise<Challenge | null> {
  const result = await query<Challenge>("SELECT * FROM challenges_archive WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function getChallengeByIdAny(id: string): Promise<Challenge & { archived: boolean } | null> {
  const result = await query<Challenge & { archived: boolean }>(
    `SELECT *, false AS archived FROM challenges WHERE id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT *, true AS archived FROM challenges_archive WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getActiveChallengesCursor(
  cursor?: string,
  limit = 20
): Promise<{ challenges: Challenge[]; nextCursor: string | null }> {
  const result = await query<Challenge>(
    `SELECT c.*, (c.pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc,
            b.name as brand_name, b.logo_url, b.primary_color, b.secondary_color
     FROM challenges c
     JOIN brands b ON c.brand_id = b.id
     WHERE c.status = 'active' AND c.deleted_at IS NULL AND b.deleted_at IS NULL
       AND ($1::uuid IS NULL OR c.id > $1::uuid)
     ORDER BY c.id
     LIMIT $2`,
    [cursor ?? null, limit + 1]
  );

  const hasMore = result.rows.length > limit;
  const challenges = result.rows.slice(0, limit);
  const nextCursor = challenges.length > 0 ? challenges[challenges.length - 1].id : null;

  return { challenges, nextCursor: hasMore ? nextCursor : null };
}

export async function getActiveChallenges(
  limit = 20,
  cursor?: string,
): Promise<{ challenges: Challenge[]; nextCursor: string | null }> {
  const cursorValues = decodeCursorSafe(cursor, ["pool_amount_stroops", "id"]);

  let whereExtra = "";
  const params: unknown[] = [];

  if (cursorValues) {
    const { clause } = buildCursorWhereSimple(
      "c.pool_amount_stroops",
      "DESC",
      cursorValues.pool_amount_stroops,
      cursorValues.id as string,
      3,
    );
    whereExtra = clause;
    params.push(cursorValues.pool_amount_stroops, cursorValues.id);
  }

  params.push(limit);
  const result = await query<Challenge>(
    `SELECT c.*, (c.pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc,
            b.name as brand_name, b.logo_url, b.primary_color, b.secondary_color
     FROM challenges c
     JOIN brands b ON c.brand_id = b.id
     WHERE c.status = 'active' AND c.deleted_at IS NULL AND b.deleted_at IS NULL
     ${whereExtra}
     ORDER BY c.pool_amount_stroops DESC, c.id DESC
     LIMIT $${params.length}`,
    params,
  );

  const challenges = result.rows;
  const nextCursor: string | null =
    challenges.length === limit
      ? encodeCursor({
          pool_amount_stroops: challenges[challenges.length - 1].pool_amount_stroops,
          id: challenges[challenges.length - 1].id,
        })
      : null;

  return { challenges, nextCursor };
}

export async function getChallengesByBrandId(
  brandId: string,
  limit = 20,
  cursor?: string,
): Promise<{ challenges: Challenge[]; nextCursor: string | null }> {
  const cursorValues = decodeCursorSafe(cursor, ["created_at", "id"]);

  let whereExtra = "";
  const params: unknown[] = [brandId];

  if (cursorValues) {
    const { clause, params: cursorParams } = buildCursorWhereSimple(
      "c.created_at",
      "DESC",
      cursorValues.created_at,
      cursorValues.id as string,
      3,
    );
    whereExtra = clause;
    params.push(cursorValues.created_at, cursorValues.id);
  }

  params.push(limit);

  const result = await query<Challenge>(
    `SELECT c.*, (c.pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc,
            b.name as brand_name, b.logo_url, b.primary_color, b.secondary_color
     FROM challenges c
     JOIN brands b ON c.brand_id = b.id
     WHERE c.brand_id = $1 AND c.deleted_at IS NULL
     ${whereExtra}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT $${params.length}`,
    params,
  );

  const challenges = result.rows;
  const nextCursor: string | null =
    challenges.length === limit
      ? encodeCursor({
          created_at: challenges[challenges.length - 1].created_at,
          id: challenges[challenges.length - 1].id,
        })
      : null;

  return { challenges, nextCursor };
}
/**
 * Soft-delete a challenge.
 */
export async function softDeleteChallenge(id: string): Promise<void> {
  await query("UPDATE challenges SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [
    id,
  ]);
}

/**
 * Restore a soft-deleted challenge.
 */
export async function restoreChallenge(id: string): Promise<void> {
  await query("UPDATE challenges SET deleted_at = NULL, updated_at = NOW() WHERE id = $1", [id]);
}

export async function updateChallengeStatus(
  id: string,
  status: ChallengeStatus,
  extras?: { depositTx?: string; payoutTxHashes?: string[] }
): Promise<void> {
  if (extras?.depositTx) {
    await query(
      "UPDATE challenges SET status = $1, deposit_tx_hash = $2 WHERE id = $3",
      [status, extras.depositTx, id]
    );
  } else if (extras?.payoutTxHashes) {
    await query(
      "UPDATE challenges SET status = $1, payout_tx_hashes = $2 WHERE id = $3",
      [status, extras.payoutTxHashes, id]
    );
  } else {
    await query("UPDATE challenges SET status = $1 WHERE id = $2", [status, id]);
  }
}

export async function insertChallengeQuestions(
  questions: Omit<ChallengeQuestion, "id">[]
): Promise<void> {
  for (const q of questions) {
    await query(
      `INSERT INTO challenge_questions
         (challenge_id, round, question_type, prompt_type, question_text,
          correct_answer, option_a, option_b, option_c, option_d, correct_option)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        q.challenge_id, q.round, q.question_type, q.prompt_type,
        q.question_text, q.correct_answer,
        q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option,
      ]
    );
  }
}

export async function getChallengeQuestions(challengeId: string): Promise<ChallengeQuestion[]> {
  const result = await query<ChallengeQuestion>(
    "SELECT * FROM challenge_questions WHERE challenge_id = $1 ORDER BY round",
    [challengeId]
  );
  return result.rows;
}

/**
 * Increment deposit confirmations for a challenge.
 * Returns the updated confirmation count.
 * If confirmations reach required threshold, transitions to active status.
 */
export async function incrementDepositConfirmations(
  challengeId: string,
  requiredConfirmations: number
): Promise<{ confirmations: number; activated: boolean }> {
  const result = await query<{ deposit_confirmations: number; status: ChallengeStatus }>(
    `UPDATE challenges
     SET deposit_confirmations = LEAST(deposit_confirmations + 1, $2),
         status = CASE 
           WHEN (deposit_confirmations + 1) >= $2 AND status = 'pending_deposit'
             THEN 'active'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = $1 AND status IN ('pending_deposit', 'active')
     RETURNING deposit_confirmations, status`,
    [challengeId, requiredConfirmations]
  );

  if (!result.rows[0]) {
    throw new Error(`Challenge ${challengeId} not found or not in pending/active status`);
  }

  const { deposit_confirmations, status } = result.rows[0];
  return {
    confirmations: deposit_confirmations,
    activated: status === "active" && deposit_confirmations >= requiredConfirmations,
  };
}

/**
 * Get current deposit confirmation count for a challenge.
 */
export async function getDepositConfirmations(challengeId: string): Promise<number | null> {
  const result = await query<{ deposit_confirmations: number }>(
    "SELECT deposit_confirmations FROM challenges WHERE id = $1 AND status IN ('pending_deposit', 'active')",
    [challengeId]
  );
  return result.rows[0]?.deposit_confirmations ?? null;
}

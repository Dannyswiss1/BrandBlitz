import type { PoolClient } from "pg";
import { pool, query } from "../index";

export interface GameSession {
  id: string;
  user_id: string;
  challenge_id: string;
  device_id: string | null;
  warmup_started_at: string | null;
  warmup_completed_at: string | null;
  challenge_started_at: string | null;
  completed_at: string | null;
  round_1_answer: string | null;
  round_1_score: number;
  round_2_answer: string | null;
  round_2_score: number;
  round_3_answer: string | null;
  round_3_score: number;
  total_score: number;
  rank: number | null;
  flagged: boolean;
  flag_reasons: string[] | null;
  is_practice: boolean;
  integrity_hmac: string | null;
  created_at: string;
}

export interface RoundScore {
  id: string;
  session_id: string;
  round: 1 | 2 | 3;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface LeaderboardSession extends GameSession {
  username: string;
  avatar_url: string;
  display_name: string;
  league: "bronze" | "silver" | "gold" | null;
  total_earned_usdc: string;
  stellar_address: string | null;
}

export async function createSession(data: {
  userId: string;
  challengeId: string;
  deviceId?: string;
  isPractice?: boolean;
}): Promise<GameSession> {
  const result = await query<GameSession>(
    `INSERT INTO game_sessions (user_id, challenge_id, device_id, is_practice)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, challenge_id) DO UPDATE
       SET user_id = game_sessions.user_id
     RETURNING *`,
    [data.userId, data.challengeId, data.deviceId ?? null, data.isPractice ?? false]
  );
  return result.rows[0];
}

export async function claimSession(data: {
  userId: string;
  challengeId: string;
  deviceId?: string;
  isPractice?: boolean;
}): Promise<GameSession | null> {
  const result = await query<GameSession>(
    `INSERT INTO game_sessions (user_id, challenge_id, device_id, is_practice)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, challenge_id) DO NOTHING
     RETURNING *`,
    [data.userId, data.challengeId, data.deviceId ?? null, data.isPractice ?? false]
  );
  return result.rows[0] ?? null;
}

export async function getSession(userId: string, challengeId: string): Promise<GameSession | null> {
  const result = await query<GameSession>(
    "SELECT * FROM game_sessions WHERE user_id = $1 AND challenge_id = $2",
    [userId, challengeId]
  );
  return result.rows[0] ?? null;
}

export async function markWarmupStarted(sessionId: string): Promise<void> {
  await query(
    "UPDATE game_sessions SET warmup_started_at = COALESCE(warmup_started_at, NOW()) WHERE id = $1",
    [sessionId]
  );
}

export async function markWarmupCompleted(sessionId: string): Promise<void> {
  const result = await query(
    `UPDATE game_sessions
     SET warmup_completed_at = NOW()
     WHERE id = $1
       AND warmup_completed_at IS NULL
     RETURNING id`,
    [sessionId]
  );

  if (result.rowCount === 0) {
    throw new Error("Warmup already completed or session not found");
  }
}

export async function markChallengeStarted(sessionId: string): Promise<void> {
  await query(
    `UPDATE game_sessions
     SET challenge_started_at = COALESCE(challenge_started_at, NOW()),
         status = 'active'
     WHERE id = $1`,
    [sessionId]
  );
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordRoundScore(
  sessionId: string,
  round: 1 | 2 | 3,
  score: number,
  answer: string | null = null,
  reactionTimeMs: number | null = null
): Promise<void> {
  if (![1, 2, 3].includes(round)) {
    throw new Error("Invalid round");
  }

  const roundColumn = `round_${round}_score`;
  const answerColumn = `round_${round}_answer`;
  const reactionColumn = `round_${round}_reaction_ms`;

  await query(
    `WITH upserted AS (
       INSERT INTO session_round_scores (session_id, round, score, answer, reaction_time_ms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, round) DO UPDATE
         SET score = EXCLUDED.score,
             answer = EXCLUDED.answer,
             reaction_time_ms = EXCLUDED.reaction_time_ms
       RETURNING session_id, score, answer, reaction_time_ms
     )
     UPDATE game_sessions
     SET ${roundColumn} = (SELECT score FROM upserted),
         ${answerColumn} = (SELECT answer FROM upserted),
         ${reactionColumn} = (SELECT reaction_time_ms FROM upserted)
     WHERE id = $1`,
    [sessionId, round, score, answer, reactionTimeMs]
  );
}

export async function finishSession(sessionId: string): Promise<GameSession> {
  return withTransaction<GameSession>(async (client) => {
    const sessionResult = await client.query<GameSession>(
      `SELECT *
       FROM game_sessions
       WHERE id = $1
       FOR UPDATE`,
      [sessionId]
    );
    const current = sessionResult.rows[0];
    if (!current) {
      throw new Error("Session not found");
    }

    if (current.completed_at) {
      return current;
    }

    const totalResult = await client.query<{ total_score: number }>(
      `SELECT COALESCE(SUM(score)::int, 0) AS total_score
       FROM session_round_scores
       WHERE session_id = $1`,
      [sessionId]
    );
    const totalScore = totalResult.rows[0]?.total_score ?? 0;

    const finishedResult = await client.query<GameSession>(
      `UPDATE game_sessions
       SET completed_at = NOW(),
           status = 'completed',
           total_score = $2
       WHERE id = $1
       RETURNING *`,
      [sessionId, totalScore]
    );
    const finished = finishedResult.rows[0];
    if (!finished) {
      throw new Error("Session not found");
    }

    await client.query(
      `UPDATE users
       SET total_score = total_score + $2,
           challenges_played = challenges_played + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [finished.user_id, finished.total_score]
    );

    return finished;
  });
}

export async function storeSessionHmac(sessionId: string, hmac: string): Promise<void> {
  await query(
    "UPDATE game_sessions SET integrity_hmac = $1 WHERE id = $2",
    [hmac, sessionId]
  );
}

export async function flagSession(
  sessionId: string,
  reasons: string[]
): Promise<void> {
  await query(
    `UPDATE game_sessions
     SET flagged = TRUE,
         status = 'flagged',
         flag_reasons = array_cat(COALESCE(flag_reasons, '{}'), $1::text[])
     WHERE id = $2`,
    [reasons, sessionId]
  );
}

export async function markAbandonedSessions(): Promise<number> {
  const result = await query<{ count: number }>(
    `WITH abandoned AS (
       UPDATE game_sessions
       SET status = 'abandoned',
           completed_at = COALESCE(completed_at, NOW()),
           updated_at = NOW()
       WHERE status IN ('warmup', 'active')
         AND COALESCE(challenge_started_at, warmup_started_at, created_at) < NOW() - INTERVAL '2 hours'
       RETURNING id
     )
     SELECT COUNT(*)::int AS count FROM abandoned`
  );

  return result.rows[0]?.count ?? 0;
}

export async function getLeaderboard(
  challengeId: string,
  limit = 20,
  offset = 0
): Promise<LeaderboardSession[]> {
  const result = await query<LeaderboardSession>(
    `SELECT gs.*,
            u.email AS username,
            u.avatar_url,
            u.display_name,
            u.league,
            u.total_earned_usdc,
            COALESCE(
              NULLIF(to_jsonb(u) ->> 'embedded_wallet_address', ''),
              NULLIF(to_jsonb(u) ->> 'stellar_address', '')
            ) AS stellar_address
     FROM game_sessions gs
     JOIN users u ON gs.user_id = u.id
     WHERE gs.challenge_id = $1
       AND gs.flagged = FALSE
       AND gs.is_practice = FALSE
       AND gs.status = 'completed'
       AND u.deleted_at IS NULL
     ORDER BY gs.total_score DESC, gs.completed_at ASC
     LIMIT $2 OFFSET $3`,
    [challengeId, limit, offset]
  );
  return result.rows;
}

export async function getTopSessionsPerChallenge(
  challengeIds: string[],
  limitPerChallenge = 10
): Promise<LeaderboardSession[]> {
  if (challengeIds.length === 0) {
    return [];
  }

  const result = await query<LeaderboardSession & { challenge_rank: number }>(
    `WITH ranked AS (
       SELECT gs.*,
              u.email AS username,
              u.avatar_url,
              u.display_name,
              u.league,
              u.total_earned_usdc,
              COALESCE(
                NULLIF(to_jsonb(u) ->> 'embedded_wallet_address', ''),
                NULLIF(to_jsonb(u) ->> 'stellar_address', '')
              ) AS stellar_address,
              ROW_NUMBER() OVER (
                PARTITION BY gs.challenge_id
                ORDER BY gs.total_score DESC, gs.completed_at ASC
              ) AS challenge_rank
       FROM game_sessions gs
       JOIN users u ON gs.user_id = u.id
       WHERE gs.challenge_id = ANY($1::uuid[])
         AND gs.flagged = FALSE
         AND gs.is_practice = FALSE
         AND gs.status = 'completed'
         AND u.deleted_at IS NULL
     )
     SELECT *
     FROM ranked
     WHERE challenge_rank <= $2
     ORDER BY challenge_id ASC, challenge_rank ASC`,
    [challengeIds, limitPerChallenge]
  );

  return result.rows;
}

export interface GlobalLeaderboardRow {
  challenge_id: string;
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  league: "bronze" | "silver" | "gold" | null;
  avatar_url: string | null;
  total_score: number;
  total_earned_usdc: string;
}

export async function getGlobalLeaderboardFromView(
  challengeIds: string[],
  limitPerChallenge = 10
): Promise<GlobalLeaderboardRow[]> {
  if (challengeIds.length === 0) return [];
  const result = await query<GlobalLeaderboardRow>(
    `SELECT challenge_id, rank, user_id, username, display_name, league, avatar_url,
            total_score, total_earned_usdc
     FROM v_leaderboard_global
     WHERE challenge_id = ANY($1::uuid[]) AND rank <= $2
     ORDER BY challenge_id ASC, rank ASC`,
    [challengeIds, limitPerChallenge]
  );
  return result.rows;
}

export async function getArchivedLeaderboard(
  challengeId: string,
  limit = 20,
  offset = 0
): Promise<Array<GameSession & { username: string; avatar_url: string }>> {
  const result = await query<GameSession & { username: string; avatar_url: string }>(
    `SELECT gs.*, u.email as username, u.avatar_url
     FROM game_sessions_archive gs
     JOIN users u ON gs.user_id = u.id
     WHERE gs.challenge_id = $1
       AND gs.flagged = FALSE
       AND gs.is_practice = FALSE
       AND gs.status = 'completed'
       AND u.deleted_at IS NULL
     ORDER BY gs.total_score DESC, gs.challenge_ended_at ASC
     LIMIT $2 OFFSET $3`,
    [challengeId, limit, offset]
  );
  return result.rows;
}

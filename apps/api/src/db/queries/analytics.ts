import { query } from "../index";

export interface BrandAnalytics {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  questionAccuracy: Array<{
    round: number;
    questionType: string;
    questionText: string;
    totalAttempts: number;
    correctAttempts: number;
    accuracy: number;
  }>;
  costPerSession: Array<{
    date: string;
    totalCost: number;
    sessionCount: number;
    costPerSession: number;
  }>;
}

export async function getBrandAnalytics(
  brandId: string,
  from?: Date,
  to?: Date
): Promise<BrandAnalytics> {
  const challengeIds = await getChallengeIdsForBrand(brandId, from, to);

  if (challengeIds.length === 0) {
    return {
      totalSessions: 0,
      completedSessions: 0,
      completionRate: 0,
      questionAccuracy: [],
      costPerSession: [],
    };
  }

  const [sessionStats, questionAccuracy, costData] = await Promise.all([
    getSessionStats(challengeIds),
    getQuestionAccuracy(challengeIds),
    getCostPerSession(challengeIds, from, to),
  ]);

  return {
    totalSessions: sessionStats.totalSessions,
    completedSessions: sessionStats.completedSessions,
    completionRate: sessionStats.totalSessions > 0
      ? Math.round((sessionStats.completedSessions / sessionStats.totalSessions) * 100)
      : 0,
    questionAccuracy,
    costPerSession: costData,
  };
}

async function getChallengeIdsForBrand(
  brandId: string,
  from?: Date,
  to?: Date
): Promise<string[]> {
  let sql = `SELECT id FROM challenges WHERE brand_id = $1 AND deleted_at IS NULL`;
  const params: unknown[] = [brandId];

  if (from) {
    params.push(from.toISOString());
    sql += ` AND created_at >= $${params.length}`;
  }
  if (to) {
    params.push(to.toISOString());
    sql += ` AND created_at <= $${params.length}`;
  }

  const result = await query<{ id: string }>(sql, params);
  return result.rows.map((r) => r.id);
}

async function getSessionStats(
  challengeIds: string[]
): Promise<{ totalSessions: number; completedSessions: number }> {
  const result = await query<{ total_sessions: number; completed_sessions: number }>(
    `SELECT
       COUNT(*)::int AS total_sessions,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_sessions
     FROM game_sessions
     WHERE challenge_id = ANY($1::uuid[])`,
    [challengeIds]
  );

  const row = result.rows[0];
  return {
    totalSessions: row?.total_sessions ?? 0,
    completedSessions: row?.completed_sessions ?? 0,
  };
}

async function getQuestionAccuracy(
  challengeIds: string[]
): Promise<BrandAnalytics["questionAccuracy"]> {
  if (challengeIds.length === 0) return [];

  const result = await query<{
    round: number;
    question_type: string;
    question_text: string;
    total_attempts: number;
    correct_attempts: number;
  }>(
    `SELECT
       cq.round,
       cq.question_type,
       cq.question_text,
       COUNT(srs.id)::int AS total_attempts,
       COUNT(srs.id) FILTER (WHERE srs.score > 0)::int AS correct_attempts
     FROM challenge_questions cq
     LEFT JOIN session_round_scores srs
       ON srs.round = cq.round
       AND srs.session_id IN (
         SELECT id FROM game_sessions
         WHERE challenge_id = ANY($1::uuid[])
           AND status = 'completed'
       )
     WHERE cq.challenge_id = ANY($1::uuid[])
     GROUP BY cq.round, cq.question_type, cq.question_text
     ORDER BY cq.round`,
    [challengeIds]
  );

  return result.rows.map((row) => ({
    round: row.round,
    questionType: row.question_type,
    questionText: row.question_text,
    totalAttempts: row.total_attempts,
    correctAttempts: row.correct_attempts,
    accuracy: row.total_attempts > 0
      ? Math.round((row.correct_attempts / row.total_attempts) * 100)
      : 0,
  }));
}

async function getCostPerSession(
  challengeIds: string[],
  from?: Date,
  to?: Date
): Promise<BrandAnalytics["costPerSession"]> {
  const fromDate = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ?? new Date();

  const result = await query<{
    date: string;
    total_cost: number;
    session_count: number;
  }>(
    `SELECT
       DATE(gs.created_at) AS date,
       SUM(c.pool_amount_stroops::numeric / 10000000)::numeric(20,7)::float AS total_cost,
       COUNT(gs.id)::int AS session_count
     FROM game_sessions gs
     JOIN challenges c ON c.id = gs.challenge_id
     WHERE gs.challenge_id = ANY($1::uuid[])
       AND gs.created_at >= $2
       AND gs.created_at <= $3
     GROUP BY DATE(gs.created_at)
     ORDER BY date`,
    [challengeIds, fromDate.toISOString(), toDate.toISOString()]
  );

  return result.rows.map((row) => ({
    date: row.date,
    totalCost: Number(row.total_cost),
    sessionCount: row.session_count,
    costPerSession: row.session_count > 0
      ? Number(row.total_cost) / row.session_count
      : 0,
  }));
}

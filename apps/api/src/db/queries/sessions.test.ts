import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `sessions_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${schema}`;
  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption
  );
  return url.toString();
}

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = withSearchPath(originalDatabaseUrl, schemaName);
}

const describeIntegration = originalDatabaseUrl ? describe : describe.skip;

describeIntegration("sessions db queries", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;
  let sessions: typeof import("./sessions");

  async function createUser(emailPrefix: string) {
    const result = await query<{ id: string }>(
      `INSERT INTO users (email, avatar_url)
       VALUES ($1, $2)
       RETURNING id`,
      [`${emailPrefix}-${randomUUID()}@example.test`, `https://example.test/${emailPrefix}.png`]
    );
    return result.rows[0].id;
  }

  async function createChallenge() {
    const result = await query<{ id: string }>(
      "INSERT INTO challenges DEFAULT VALUES RETURNING id"
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    const db = await import("../index");
    query = db.query;
    closeDb = db.closeDb;
    sessions = await import("./sessions");

    await query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        avatar_url TEXT,
        display_name TEXT,
        league TEXT,
        total_earned_usdc NUMERIC(20, 7) NOT NULL DEFAULT 0,
        stellar_address TEXT,
        deleted_at TIMESTAMPTZ
      )
    `);
    await query(`
      CREATE TABLE challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      )
    `);
    await query(`
      CREATE TABLE game_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        device_id TEXT,
        status TEXT NOT NULL DEFAULT 'warmup' CHECK (status IN ('warmup', 'active', 'completed', 'flagged')),
        warmup_started_at TIMESTAMPTZ,
        warmup_completed_at TIMESTAMPTZ,
        challenge_started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        round_1_score INTEGER NOT NULL DEFAULT 0,
        round_2_score INTEGER NOT NULL DEFAULT 0,
        round_3_score INTEGER NOT NULL DEFAULT 0,
        total_score INTEGER NOT NULL DEFAULT 0,
        flagged BOOLEAN NOT NULL DEFAULT FALSE,
        flag_reasons TEXT[] NOT NULL DEFAULT '{}',
        is_practice BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, challenge_id)
      )
    `);
    await query(`
      CREATE INDEX idx_game_sessions_user_id_completed_at
      ON game_sessions (user_id, completed_at DESC)
    `);
    await query(`
      CREATE TABLE session_round_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL CHECK (round IN (1, 2, 3)),
        score INTEGER NOT NULL CHECK (score >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, round)
      )
    `);
  });

  afterAll(async () => {
    if (query) {
      await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    }
    if (closeDb) {
      await closeDb();
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("createSession sets defaults and returns the unique session per user/challenge", async () => {
    const userId = await createUser("create-session");
    const challengeId = await createChallenge();

    const first = await sessions.createSession({
      userId,
      challengeId,
      deviceId: "device-1",
    });
    const second = await sessions.createSession({
      userId,
      challengeId,
      deviceId: "device-2",
      isPractice: true,
    });

    expect(second.id).toBe(first.id);
    expect(first.user_id).toBe(userId);
    expect(first.challenge_id).toBe(challengeId);
    expect(first.device_id).toBe("device-1");
    expect(first.round_1_score).toBe(0);
    expect(first.round_2_score).toBe(0);
    expect(first.round_3_score).toBe(0);
    expect(first.total_score).toBe(0);
    expect(first.flagged).toBe(false);
    expect(first.flag_reasons).toEqual([]);
    expect(first.is_practice).toBe(false);

    const count = await query<{ count: string }>(
      "SELECT COUNT(*) FROM game_sessions WHERE user_id = $1 AND challenge_id = $2",
      [userId, challengeId]
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it("marks warmup timestamps and rejects a second warmup completion", async () => {
    const userId = await createUser("warmup");
    const challengeId = await createChallenge();
    const session = await sessions.createSession({ userId, challengeId });

    await sessions.markWarmupStarted(session.id);
    await sessions.markWarmupCompleted(session.id);

    const updated = await sessions.getSession(userId, challengeId);
    expect(updated?.warmup_started_at).toBeTruthy();
    expect(updated?.warmup_completed_at).toBeTruthy();

    await expect(sessions.markWarmupCompleted(session.id)).rejects.toThrow(
      "Warmup already completed"
    );
  });

  it("upserts round scores without duplicates under concurrent calls", async () => {
    const userId = await createUser("round-score");
    const challengeId = await createChallenge();
    const session = await sessions.createSession({ userId, challengeId });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        sessions.recordRoundScore(session.id, 1, 100 + index)
      )
    );

    const roundRows = await query<{ count: string; score: number }>(
      `SELECT COUNT(*) AS count, MAX(score)::int AS score
       FROM session_round_scores
       WHERE session_id = $1 AND round = 1`,
      [session.id]
    );
    expect(Number(roundRows.rows[0].count)).toBe(1);
    expect(roundRows.rows[0].score).toBeGreaterThanOrEqual(100);
    expect(roundRows.rows[0].score).toBeLessThanOrEqual(119);

    await sessions.recordRoundScore(session.id, 2, 125);
    await sessions.recordRoundScore(session.id, 3, 150);

    const stored = await sessions.getSession(userId, challengeId);
    expect(stored?.round_1_score).toBe(roundRows.rows[0].score);
    expect(stored?.round_2_score).toBe(125);
    expect(stored?.round_3_score).toBe(150);
  });

  it("finishSession sums round scores and sets the challenge end timestamp", async () => {
    const userId = await createUser("finish");
    const challengeId = await createChallenge();
    const session = await sessions.createSession({ userId, challengeId });

    await sessions.recordRoundScore(session.id, 1, 111);
    await sessions.recordRoundScore(session.id, 2, 122);
    await sessions.recordRoundScore(session.id, 3, 133);

    const finished = await sessions.finishSession(session.id);

    expect(finished.completed_at).toBeTruthy();
    expect(finished.total_score).toBe(366);
  });

  it("flagSession appends flag reasons", async () => {
    const userId = await createUser("flag");
    const challengeId = await createChallenge();
    const session = await sessions.createSession({ userId, challengeId });

    await sessions.flagSession(session.id, ["superhuman_reaction_time"]);
    await sessions.flagSession(session.id, ["multi_account_device"]);

    const flagged = await sessions.getSession(userId, challengeId);
    expect(flagged?.flagged).toBe(true);
    expect(flagged?.flag_reasons).toEqual([
      "superhuman_reaction_time",
      "multi_account_device",
    ]);
  });

  it("getLeaderboard excludes flagged and practice sessions and orders by score then finish time", async () => {
    const challengeId = await createChallenge();
    const highScoreUser = await createUser("leader-high");
    const fastTieUser = await createUser("leader-fast-tie");
    const slowTieUser = await createUser("leader-slow-tie");
    const flaggedUser = await createUser("leader-flagged");
    const practiceUser = await createUser("leader-practice");

    const high = await sessions.createSession({ userId: highScoreUser, challengeId });
    const fastTie = await sessions.createSession({ userId: fastTieUser, challengeId });
    const slowTie = await sessions.createSession({ userId: slowTieUser, challengeId });
    const flagged = await sessions.createSession({ userId: flaggedUser, challengeId });
    const practice = await sessions.createSession({
      userId: practiceUser,
      challengeId,
      isPractice: true,
    });

    for (const [sessionId, score] of [
      [high.id, 420],
      [fastTie.id, 300],
      [slowTie.id, 300],
      [flagged.id, 450],
      [practice.id, 450],
    ] as const) {
      await sessions.recordRoundScore(sessionId, 1, score);
      await sessions.finishSession(sessionId);
    }

    await sessions.flagSession(flagged.id, ["bot"]);
    await query("UPDATE game_sessions SET completed_at = $2 WHERE id = $1", [
      fastTie.id,
      "2026-01-01T00:00:00.000Z",
    ]);
    await query("UPDATE game_sessions SET completed_at = $2 WHERE id = $1", [
      slowTie.id,
      "2026-01-01T00:00:05.000Z",
    ]);

    const leaderboard = await sessions.getLeaderboard(challengeId, 10);

    expect(leaderboard.map((entry) => entry.user_id)).toEqual([
      highScoreUser,
      fastTieUser,
      slowTieUser,
    ]);
    expect(leaderboard.map((entry) => entry.total_score)).toEqual([420, 300, 300]);
    expect(leaderboard.map((entry) => entry.username)).toHaveLength(3);
    expect(leaderboard.some((entry) => entry.user_id === flaggedUser)).toBe(false);
    expect(leaderboard.some((entry) => entry.user_id === practiceUser)).toBe(false);
  });

  it("uses the recent sessions index for profile lookups under 5ms", async () => {
    const userId = await createUser("profile-sessions");

    for (let index = 0; index < 1000; index += 1) {
      const challengeId = await createChallenge();
      const session = await sessions.createSession({ userId, challengeId });

      await query(
        `UPDATE game_sessions
         SET status = 'completed',
             completed_at = NOW() - ($2::int * INTERVAL '1 minute'),
             total_score = $3
         WHERE id = $1`,
        [session.id, index, index]
      );
    }

    const plan = await query<{
      "QUERY PLAN": [
        {
          Plan: { "Node Type": string; Plans?: unknown[] };
          "Execution Time": number;
        },
      ];
    }>(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT id, challenge_id, completed_at, total_score
       FROM game_sessions
       WHERE user_id = $1
       ORDER BY completed_at DESC
       LIMIT 20`,
      [userId]
    );

    const analyzed = plan.rows[0]["QUERY PLAN"][0];
    const serializedPlan = JSON.stringify(analyzed.Plan);

    expect(serializedPlan).toContain("idx_game_sessions_user_id_completed_at");
    expect(analyzed["Execution Time"]).toBeLessThan(5);
  });
});

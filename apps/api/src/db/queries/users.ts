import type { PoolClient } from "pg";
import { pool, query } from "../index";

export interface User {
  id: string;
  email: string;
  google_id: string | null;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  role: string;
  status: "active" | "suspended";
  suspension_reason: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  phone_hash: string | null;
  phone_verified: boolean;
  phone_verified_at: string | null;
  age_verified: boolean;
  kyc_complete: boolean;
  stellar_address: string | null;
  embedded_wallet_address: string | null;
  referral_code: string | null;
  league: "bronze" | "silver" | "gold" | null;
  total_score: number;
  total_earned_usdc: string;
  challenges_played: number;
  state_code: string | null;
  streak: number;
  last_play_day: string | null;
  streak_repairs_this_month: number;
  streak_repair_available: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  display_name: string;
  username: string;
  league: "bronze" | "silver" | "gold" | null;
  total_earned_usdc: string;
  challenges_played: number;
  avatar_url: string | null;
  streak: number;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await query<User>("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1", [email]);
  return result.rows[0] ?? null;
}

export async function findUserByGoogleId(googleId: string): Promise<User | null> {
  const result = await query<User>("SELECT * FROM users WHERE google_id = $1 AND deleted_at IS NULL LIMIT 1", [googleId]);
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const result = await query<User>("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [id]);
  return result.rows[0] ?? null;
}

export async function findUserByPhoneHash(phoneHash: string): Promise<User | null> {
  const result = await query<User>("SELECT * FROM users WHERE phone_hash = $1 AND deleted_at IS NULL LIMIT 1", [
    phoneHash,
  ]);
  return result.rows[0] ?? null;
}

export async function findUserByReferralCode(referralCode: string): Promise<User | null> {
  const result = await query<User>("SELECT * FROM users WHERE referral_code = $1 AND deleted_at IS NULL LIMIT 1", [
    referralCode,
  ]);
  return result.rows[0] ?? null;
}

export async function getUserReferralCode(userId: string): Promise<string | null> {
  const result = await query<{ referral_code: string | null }>(
    "SELECT referral_code FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
    [userId]
  );
  return result.rows[0]?.referral_code ?? null;
}

export async function setUserReferralCode(userId: string, referralCode: string): Promise<void> {
  await query(
    `UPDATE users
     SET referral_code = $1,
         updated_at = NOW()
     WHERE id = $2
       AND referral_code IS NULL`,
    [referralCode, userId]
  );
}

function slugifyUsername(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 24);
}

async function allocateUsername(
  client: PoolClient,
  displayName: string,
  email: string
): Promise<string> {
  const base =
    slugifyUsername(displayName) || slugifyUsername(email.split("@")[0] ?? "") || "player";
  const prefix = `${base}-%`;
  const result = await client.query<{ username: string }>(
    `SELECT username
     FROM users
     WHERE (username = $1 OR username LIKE $2) AND deleted_at IS NULL`,
    [base, prefix]
  );

  const taken = new Set(result.rows.map((row) => row.username));
  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export async function getUserPublicProfileByUsername(username: string): Promise<PublicUser | null> {
  const result = await query<PublicUser>(
    `SELECT display_name, username, league, total_earned_usdc, challenges_played, avatar_url, streak
     FROM users
     WHERE username = $1 AND deleted_at IS NULL`,
    [username]
  );
  return result.rows[0] ?? null;
}

export async function upsertUser(data: {
  email: string;
  googleId: string;
  name?: string;
  avatarUrl?: string;
}): Promise<User> {
  const displayName = data.name?.trim() || data.email.split("@")[0] || "BrandBlitz User";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const username = await allocateUsername(client, displayName, data.email);
      const result = await client.query<User>(
        `INSERT INTO users (email, google_id, display_name, username, avatar_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (google_id) DO UPDATE
           SET email = EXCLUDED.email,
               display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
               username = COALESCE(users.username, EXCLUDED.username),
               avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
               updated_at = NOW()
         RETURNING *`,
        [data.email, data.googleId, displayName, username, data.avatarUrl ?? null]
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        attempt < 2 &&
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error("Unable to allocate username");
}

export async function updateUserWallet(userId: string, stellarAddress: string): Promise<void> {
  await query("UPDATE users SET stellar_address = $1, updated_at = NOW() WHERE id = $2", [
    stellarAddress,
    userId,
  ]);
}

export async function updateUserProfile(
  userId: string,
  data: { displayName?: string; username?: string }
): Promise<{ oldUsername: string | null; newUsername: string | null }> {
  const current = await query<{ display_name: string; username: string | null }>(
    `SELECT display_name, username FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (!current.rows[0]) throw new Error("User not found");

  const oldUsername = current.rows[0].username;
  const displayName = data.displayName ?? current.rows[0].display_name;
  const newUsername = data.username ?? current.rows[0].username;

  await query(
    `UPDATE users SET display_name = $2, username = $3, updated_at = NOW() WHERE id = $1`,
    [userId, displayName, newUsername]
  );

  return { oldUsername, newUsername };
}

export async function incrementUserEarnings(userId: string, amountUsdc: string): Promise<void> {
  await query(
    `UPDATE users
     SET total_earned_usdc = total_earned_usdc + $1::numeric,
         updated_at = NOW()
     WHERE id = $2`,
    [amountUsdc, userId]
  );
}

export interface StreakState {
  id: string;
  streak: number;
  last_play_day: string | null;
  streak_repairs_this_month: number;
  streak_repair_available: boolean;
}

export async function getUserStreak(userId: string): Promise<StreakState | null> {
  const result = await query<StreakState>(
    `SELECT id, streak, last_play_day, streak_repairs_this_month, streak_repair_available
     FROM users
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function setUserStreak(data: {
  userId: string;
  streak: number;
  lastPlayDay: string;
  repairAvailable: boolean;
}): Promise<StreakState> {
  const result = await query<StreakState>(
    `UPDATE users
     SET streak = $2,
         last_play_day = $3::date,
         streak_repair_available = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, streak, last_play_day, streak_repairs_this_month, streak_repair_available`,
    [data.userId, data.streak, data.lastPlayDay, data.repairAvailable]
  );
  return result.rows[0];
}

export async function repairUserStreak(
  userId: string,
  playDay: string
): Promise<StreakState | null> {
  const result = await query<StreakState>(
    `UPDATE users
     SET streak = GREATEST(streak, 1),
         last_play_day = $2::date,
         streak_repair_available = FALSE,
         streak_repairs_this_month = streak_repairs_this_month + 1,
         updated_at = NOW()
     WHERE id = $1
       AND streak_repairs_this_month < 1
     RETURNING id, streak, last_play_day, streak_repairs_this_month, streak_repair_available`,
    [userId, playDay]
  );
  return result.rows[0] ?? null;
}

export async function markPhoneVerified(userId: string, phoneHash: string): Promise<void> {
  await query(
    `UPDATE users
     SET phone_hash = $1,
         phone_verified = TRUE,
         phone_verified_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [phoneHash, userId]
  );
}

/**
 * Soft-delete a user row.
 */
export async function softDeleteUser(userId: string): Promise<void> {
  await query("UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [
    userId,
  ]);
}

/**
 * Restore a soft-deleted user.
 */
export async function restoreUser(userId: string): Promise<void> {
  await query("UPDATE users SET deleted_at = NULL, updated_at = NOW() WHERE id = $1", [userId]);
}

/**
 * Permanently remove a user row.
 * WARNING: DBA-only operation. Use GDPR anonymisation (anonymizeUser) for
 * right-to-erasure requests. Hard-delete is blocked while fraud_flags rows
 * reference this user (ON DELETE RESTRICT).
 */
export async function hardDeleteUser(userId: string): Promise<void> {
  await query("DELETE FROM users WHERE id = $1 /* include_deleted */", [userId]);
}

/**
 * Suspend a user account. Sets status to 'suspended' with a reason.
 * Closes #140
 */
export async function suspendUser(
  userId: string,
  reason: string,
  adminId: string,
): Promise<User | null> {
  const result = await query<User>(
    `UPDATE users
     SET status = 'suspended',
         suspension_reason = $2,
         suspended_at = NOW(),
         suspended_by = $3,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [userId, reason, adminId],
  );
  return result.rows[0] ?? null;
}

/**
 * Unsuspend a previously suspended user account.
 */
export async function unsuspendUser(userId: string): Promise<User | null> {
  const result = await query<User>(
    `UPDATE users
     SET status = 'active',
         suspension_reason = NULL,
         suspended_at = NULL,
         suspended_by = NULL,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * List users with optional status filter and search.
 * Used by the admin suspension dashboard.
 */
export async function listUsers(opts: {
  status?: "active" | "suspended";
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ users: User[]; total: number }> {
  const { status, search, page = 1, pageSize = 20 } = opts;
  const conditions: string[] = ["deleted_at IS NULL"];
  const params: (string | number)[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`status = $${paramIdx}`);
    params.push(status);
    paramIdx++;
  }

  if (search?.trim()) {
    conditions.push(
      `(display_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR username ILIKE $${paramIdx})`,
    );
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  const where = conditions.join(" AND ");
  const offset = (page - 1) * pageSize;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  const dataParams = [...params, pageSize, offset];
  const result = await query<User>(
    `SELECT * FROM users WHERE ${where}
     ORDER BY suspended_at DESC NULLS LAST, created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    dataParams,
  );

  return { users: result.rows, total };
}

export async function updateLastLogin(userId: string): Promise<void> {
  await query(
    "UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1",
    [userId],
  );
}

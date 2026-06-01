import { randomUUID } from "crypto";
import { query } from "../index";

export interface GdprErasureRequest {
  id: string;
  user_id: string;
  requested_at: string;
  execute_at: string;
  cancelled_at: string | null;
  executed_at: string | null;
  admin_id: string | null;
  created_at: string;
  updated_at: string;
}

const GRACE_PERIOD_DAYS = 30;

export async function createErasureRequest(
  userId: string,
  adminId?: string
): Promise<GdprErasureRequest> {
  const executeAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const result = await query<GdprErasureRequest>(
    `INSERT INTO gdpr_erasure_requests (user_id, execute_at, admin_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, executeAt.toISOString(), adminId ?? null]
  );
  return result.rows[0];
}

export async function findPendingErasureRequest(
  userId: string
): Promise<GdprErasureRequest | null> {
  const result = await query<GdprErasureRequest>(
    `SELECT * FROM gdpr_erasure_requests
     WHERE user_id = $1
       AND cancelled_at IS NULL
       AND executed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Find a pending erasure request that was self-initiated (admin_id IS NULL).
 * Used by the self-serve cancel endpoint so users cannot see or interact with
 * admin-initiated legal erasure requests.
 */
export async function findPendingSelfErasureRequest(
  userId: string
): Promise<GdprErasureRequest | null> {
  const result = await query<GdprErasureRequest>(
    `SELECT * FROM gdpr_erasure_requests
     WHERE user_id = $1
       AND admin_id IS NULL
       AND cancelled_at IS NULL
       AND executed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Cancel a self-initiated erasure request (admin_id IS NULL).
 * Admin-initiated requests may only be cancelled through an admin endpoint.
 */
export async function cancelErasureRequest(userId: string): Promise<void> {
  await query(
    `UPDATE gdpr_erasure_requests
     SET cancelled_at = NOW(), updated_at = NOW()
     WHERE user_id = $1
       AND admin_id IS NULL
       AND cancelled_at IS NULL
       AND executed_at IS NULL`,
    [userId]
  );
}

export async function markErasureExecuted(requestId: string): Promise<void> {
  await query(
    `UPDATE gdpr_erasure_requests
     SET executed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [requestId]
  );
}

/**
 * Anonymise all PII in the users row.
 * The row is retained (not deleted) so FK references from game_sessions and
 * payouts remain valid and financial records are preserved for compliance.
 */
export async function anonymizeUser(userId: string): Promise<void> {
  const token = randomUUID();
  await query(
    `UPDATE users SET
       email                   = $2,
       google_id               = NULL,
       display_name            = 'Deleted User',
       username                = $3,
       avatar_url              = NULL,
       phone_hash              = NULL,
       phone_verified          = FALSE,
       phone_verified_at       = NULL,
       stellar_address         = NULL,
       embedded_wallet_address = NULL,
       updated_at              = NOW()
     WHERE id = $1`,
    [userId, `deleted_${token}@gdpr.invalid`, `deleted_${token}`]
  );
}

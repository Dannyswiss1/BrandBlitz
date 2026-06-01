import { query } from "../index";

export type PayoutStatus = "pending" | "sent" | "confirmed" | "failed";

export interface Payout {
  id: string;
  challenge_id: string;
  user_id: string;
  stellar_address: string;
  amount_usdc: string;
  tx_hash: string | null;
  error_message?: string | null;
  status: PayoutStatus;
  created_at: string;
}

export async function createPayout(data: {
  challengeId: string;
  userId: string;
  stellarAddress: string;
  amountUsdc: string;
}): Promise<Payout> {
  const result = await query<Payout>(
    `INSERT INTO payouts (challenge_id, user_id, stellar_address, amount_usdc)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (challenge_id, user_id) DO UPDATE
       SET stellar_address = EXCLUDED.stellar_address,
           amount_usdc = EXCLUDED.amount_usdc,
           status = CASE
             WHEN payouts.status = 'failed' THEN 'pending'
             ELSE payouts.status
           END,
           error_message = NULL
     RETURNING *`,
    [data.challengeId, data.userId, data.stellarAddress, data.amountUsdc]
  );
  return result.rows[0];
}

export async function updatePayoutStatus(
  id: string,
  status: PayoutStatus,
  txHash?: string,
  errorMessage?: string
): Promise<void> {
  if (txHash && errorMessage) {
    await query(
      "UPDATE payouts SET status = $1, tx_hash = $2, error_message = $3 WHERE id = $4",
      [status, txHash, errorMessage, id]
    );
  } else if (txHash) {
    await query(
      "UPDATE payouts SET status = $1, tx_hash = $2 WHERE id = $3",
      [status, txHash, id]
    );
  } else if (errorMessage) {
    await query(
      "UPDATE payouts SET status = $1, error_message = $2 WHERE id = $3",
      [status, errorMessage, id]
    );
  } else {
    await query("UPDATE payouts SET status = $1 WHERE id = $2", [status, id]);
  }
}

export async function failPayoutsForChallenge(
  challengeId: string,
  errorMessage: string
): Promise<void> {
  await query(
    `UPDATE payouts
     SET status = 'failed',
         error_message = $2
     WHERE challenge_id = $1
       AND status IN ('pending', 'processing')`,
    [challengeId, errorMessage]
  );
}

export async function getPendingPayouts(
  challengeId: string,
  limit = 100
): Promise<Payout[]> {
  const result = await query<Payout>(
    "SELECT * FROM payouts WHERE challenge_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT $2",
    [challengeId, limit]
  );
  return result.rows;
}

export async function findPayoutByTxHash(txHash: string): Promise<Payout | null> {
  const result = await query<Payout>(
    "SELECT * FROM payouts WHERE tx_hash = $1 LIMIT 1",
    [txHash]
  );
  return result.rows[0] ?? null;
}

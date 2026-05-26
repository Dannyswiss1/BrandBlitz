import { query } from "../index";

export type PayoutStatus = "pending" | "sent" | "confirmed" | "failed";

export interface Payout {
  id: string;
  challenge_id: string;
  user_id: string;
  stellar_address: string;
  amount_usdc: string;
  tx_hash: string | null;
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
  await query(
    "UPDATE payouts SET status = $1, tx_hash = $2, error_message = $3 WHERE id = $4",
    [status, txHash ?? null, errorMessage ?? "", id]
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

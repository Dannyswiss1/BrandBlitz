import { query } from "../index";
import { usdcToStroops } from "../../lib/usdc";

export type PayoutStatus = "pending" | "sent" | "confirmed" | "failed";

export interface Payout {
  id: string;
  challenge_id: string;
  user_id: string;
  stellar_address: string;
  amount_stroops: string;
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
  amountStroops?: string | number | bigint;
  amountUsdc?: string;
}): Promise<Payout> {
  if (data.amountStroops === undefined && data.amountUsdc === undefined) {
    throw new Error("Payout amount is required");
  }

  const amountStroops = data.amountStroops?.toString() ?? usdcToStroops(data.amountUsdc!);
  const result = await query<Payout>(
    `INSERT INTO payouts (challenge_id, user_id, stellar_address, amount_stroops)
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
     RETURNING *, (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc`,
    [data.challengeId, data.userId, data.stellarAddress, amountStroops]
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
  await query(
    "UPDATE payouts SET status = $1, tx_hash = $2, error_message = $3 WHERE id = $4",
    [status, txHash ?? null, errorMessage ?? "", id]
  );
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
    "SELECT *, (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc FROM payouts WHERE challenge_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT $2",
    [challengeId, limit]
  );
  return result.rows;
}

export async function findPayoutByTxHash(txHash: string): Promise<Payout | null> {
  const result = await query<Payout>(
    "SELECT *, (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc FROM payouts WHERE tx_hash = $1 LIMIT 1",
    [txHash]
  );
  return result.rows[0] ?? null;
}

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
     RETURNING *, (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc`,
    [data.challengeId, data.userId, data.stellarAddress, amountStroops]
  );
  return result.rows[0];
}

export async function updatePayoutStatus(
  id: string,
  status: PayoutStatus,
  txHash?: string
): Promise<void> {
  if (txHash) {
    await query(
      "UPDATE payouts SET status = $1, tx_hash = $2 WHERE id = $3",
      [status, txHash, id]
    );
  } else {
    await query("UPDATE payouts SET status = $1 WHERE id = $2", [status, id]);
  }
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

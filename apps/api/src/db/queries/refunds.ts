import { query } from "../index";

export interface Refund {
  id: string;
  challenge_id: string;
  admin_id: string;
  reason: string;
  amount_stroops: string;
  amount_usdc: string;
  destination: string;
  tx_hash: string;
  created_at: string;
}

export async function createRefund(data: {
  challengeId: string;
  adminId: string;
  reason: string;
  amountStroops: string | number | bigint;
  destination: string;
  txHash: string;
}): Promise<Refund> {
  const result = await query<Refund>(
    `INSERT INTO refunds
       (challenge_id, admin_id, reason, amount_stroops, destination, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *, (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc`,
    [
      data.challengeId,
      data.adminId,
      data.reason,
      data.amountStroops.toString(),
      data.destination,
      data.txHash,
    ]
  );
  return result.rows[0];
}

export async function findRefundByChallengeId(challengeId: string): Promise<Refund | null> {
  const result = await query<Refund>(
    `SELECT *, (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc
     FROM refunds
     WHERE challenge_id = $1
     LIMIT 1`,
    [challengeId]
  );
  return result.rows[0] ?? null;
}

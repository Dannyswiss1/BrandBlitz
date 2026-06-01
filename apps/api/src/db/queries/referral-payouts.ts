import { query } from "../index";

export type ReferralPayoutStatus = "pending" | "sent" | "failed";

export interface ReferralPayout {
  id: string;
  referral_id: string;
  challenge_id: string | null;
  referrer_id: string;
  referred_id: string;
  referrer_stellar_address: string | null;
  referred_stellar_address: string | null;
  referrer_amount_stroops: string;
  referred_amount_stroops: string;
  status: ReferralPayoutStatus;
  tx_hash: string | null;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export async function createReferralPayout(data: {
  referralId: string;
  challengeId?: string | null;
  referrerId: string;
  referredId: string;
  referrerStellarAddress: string | null;
  referredStellarAddress: string | null;
  referrerAmountStroops: bigint;
  referredAmountStroops: bigint;
}): Promise<ReferralPayout> {
  const result = await query<ReferralPayout>(
    `INSERT INTO referral_payouts (
       referral_id,
       challenge_id,
       referrer_id,
       referred_id,
       referrer_stellar_address,
       referred_stellar_address,
       referrer_amount_stroops,
       referred_amount_stroops
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (referral_id) DO UPDATE
       SET updated_at = referral_payouts.updated_at
     RETURNING *`,
    [
      data.referralId,
      data.challengeId ?? null,
      data.referrerId,
      data.referredId,
      data.referrerStellarAddress,
      data.referredStellarAddress,
      data.referrerAmountStroops.toString(),
      data.referredAmountStroops.toString(),
    ],
  );
  return result.rows[0];
}

export async function findReferralPayoutByReferralId(
  referralId: string,
): Promise<ReferralPayout | null> {
  const result = await query<ReferralPayout>(
    "SELECT * FROM referral_payouts WHERE referral_id = $1 LIMIT 1",
    [referralId],
  );
  return result.rows[0] ?? null;
}

export async function findReferralPayoutById(
  id: string,
): Promise<ReferralPayout | null> {
  const result = await query<ReferralPayout>(
    "SELECT * FROM referral_payouts WHERE id = $1 LIMIT 1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findPendingReferralPayoutById(
  id: string,
): Promise<ReferralPayout | null> {
  const result = await query<ReferralPayout>(
    "SELECT * FROM referral_payouts WHERE id = $1 AND status = 'pending' LIMIT 1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateReferralPayoutStatus(
  id: string,
  status: ReferralPayoutStatus,
  txHash?: string,
  errorMessage?: string,
): Promise<void> {
  await query(
    "UPDATE referral_payouts SET status = $1, tx_hash = $2, error_message = $3 WHERE id = $4",
    [status, txHash ?? null, errorMessage ?? "", id],
  );
}

export async function getReferralPayoutTotalsForUser(userId: string): Promise<{
  referrerStroops: bigint;
  referredStroops: bigint;
}> {
  const result = await query<{
    referrer_stroops: string;
    referred_stroops: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN referrer_id = $1 THEN referrer_amount_stroops ELSE 0 END), 0)::text AS referrer_stroops,
       COALESCE(SUM(CASE WHEN referred_id = $1 THEN referred_amount_stroops ELSE 0 END), 0)::text AS referred_stroops
     FROM referral_payouts
     WHERE status IN ('pending', 'sent') AND (referrer_id = $1 OR referred_id = $1)`,
    [userId],
  );

  const row = result.rows[0];
  return {
    referrerStroops: BigInt(row?.referrer_stroops ?? "0"),
    referredStroops: BigInt(row?.referred_stroops ?? "0"),
  };
}

import {
  isRetriableStellarError,
  submitBatchPayout,
  isInsufficientFeeError,
  type PayoutRecipient,
} from "@brandblitz/stellar";
import type { NetworkName } from "@brandblitz/stellar";
import { EscrowClient, type EscrowRecipient } from "@brandblitz/stellar";
import { getLeaderboard } from "../db/queries/sessions";
import {
  getChallengeById,
  updateChallengeStatus,
} from "../db/queries/challenges";
import { createPayout, updatePayoutStatus } from "../db/queries/payouts";
import { incrementUserEarnings } from "../db/queries/users";
import { rankWinners } from "./scoring";
import { calculatePayoutShareStroops, stroopsToUsdc } from "../lib/usdc";
import { enqueuePayoutJob } from "../queues/payout.queue";
import { enqueueLeaderboardRefresh } from "../queues/leaderboard-refresh.queue";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { config } from "../lib/config";
import { stellarSequenceStore } from "../lib/redis";
import { verifySessionHmac } from "../lib/integrity";
import { queueReferralBonusForPayout } from "./referrals";
import { query } from "../db";

// Sentinel included in the PG trigger exception message (migration 018).
export const FRAUD_BLOCK_SENTINEL = "FRAUD_BLOCKED_PAYOUT";

export function isFraudBlockError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(FRAUD_BLOCK_SENTINEL);
}

/**
 * Enqueue a payout job for a completed challenge.
 * The actual Stellar transactions are processed by the BullMQ worker.
 */

  await enqueueLeaderboardRefresh(challengeId);
  logger.info("Payout job enqueued", { challengeId, requestId });
}

/**
 * Process payout for a settled challenge.
 * Called by the BullMQ worker processor.
 */
export async function processPayout(challengeId: string): Promise<void> {
  const challenge = await getChallengeById(challengeId);
  if (!challenge) throw new Error(`Challenge ${challengeId} not found`);
  if (challenge.status !== "ended") {
    logger.warn("Payout skipped - challenge not in ended state", { challengeId });
    return;
  }

  // getLeaderboard already filters flagged=FALSE; the DB trigger (migration 018)
  // is the immutable safety net if createPayout is called through any other path.
  const sessions = await getLeaderboard(challengeId, 1000);

  for (const session of sessions) {
    if (
      !verifySessionHmac(
        session.id,
        session.total_score,
        session.completed_at ?? "",
        session.integrity_hmac,
      )
    ) {
      metrics.inc("antiCheat.integrity_hmac_tampered_total");
      logger.error("Session integrity check failed — payout aborted", {
        challengeId,
        sessionId: session.id,
        userId: session.user_id,
      });
      throw new Error(`Session ${session.id} failed integrity check`);
    }
  }

  if (sessions.length === 0) {
    await updateChallengeStatus(challengeId, "settled");
    return;
  }

  const ranked = rankWinners(
    sessions.map((s) => ({
      userId: s.user_id,
      stellarAddress: (s.stellar_address ?? "").trim(),
      totalScore: s.total_score,
      endedAt: s.completed_at ?? s.created_at,
    })),
  );

  const eligibleWinners = ranked.filter((winner) => {
    if (winner.stellarAddress) return true;
    logger.error("Winner missing Stellar address on file; skipping payout", {
      challengeId,
      userId: winner.userId,
    });
    return false;
  });

  const totalPoints = eligibleWinners.reduce((acc, s) => acc + s.totalScore, 0);
  const recipients: PayoutRecipient[] = [];
  const payoutRecords: {
    id: string;
    address: string;
    userId: string;
    amount: string;
    amountStroops: bigint;
  }[] = [];

  for (const winner of eligibleWinners) {
    const amountStroops = calculatePayoutShareStroops(
      winner.totalScore,
      totalPoints,
      challenge.pool_amount_stroops,
    );

    if (amountStroops < 1n) {
      continue;
    }

    let payout;
    try {
      payout = await createPayout({
        challengeId,
        userId: winner.userId,
        stellarAddress: winner.stellarAddress,
        amountStroops,
      });
    } catch (err) {
      if (isFraudBlockError(err)) {
        logger.warn("Payout blocked by DB fraud guard", {
          challengeId,
          userId: winner.userId,
        });
        await query(
          `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
           VALUES (NULL, $1, $2, $3, $4::jsonb)`,
          [
            "payout_blocked_fraud",
            "payout",
            `${challengeId}:${winner.userId}`,
            JSON.stringify({ challengeId, userId: winner.userId }),
          ],
        );
        continue;
      }
      throw err;
    }

    const amount = stroopsToUsdc(amountStroops);
    recipients.push({ address: winner.stellarAddress, amount });
    payoutRecords.push({
      id: payout.id,
      address: winner.stellarAddress,
      userId: winner.userId,
      amount,
      amountStroops,
    });
  }

  if (recipients.length === 0) {
    logger.error("No payout recipients available after ranking", {
      challengeId,
      rankedCount: ranked.length,
    });
    await updateChallengeStatus(challengeId, "settled");
    return;
  }

  const network = config.STELLAR_NETWORK as NetworkName;

  // Prefer escrow contract settlement when CONTRACT_ID is configured.
  if (config.SOROBAN_CONTRACT_ID) {
    try {
      const escrow = new EscrowClient({
        contractId: config.SOROBAN_CONTRACT_ID,
        horizonUrl: config.STELLAR_HORIZON_URL,
        sorobanUrl: config.STELLAR_RPC_URL,
        networkPassphrase:
          network === "testnet"
            ? "Test SDF Network ; September 2015"
            : "Public Global Stellar Network ; September 2015",
      });

      const escrowRecipients: EscrowRecipient[] = payoutRecords.map((record) => ({
        address: record.address,
        amountStroops: record.amountStroops,
      }));

      const txHash = await escrow.settle(escrowRecipients, config.HOT_WALLET_SECRET);

      for (const record of payoutRecords) {
        await updatePayoutStatus(record.id, "sent", txHash);
        await incrementUserEarnings(record.userId, record.amount);
        await queueReferralBonusForPayout({
          referredUserId: record.userId,
          challengeId,
          referralWinAmountStroops: record.amountStroops,
        });
      }

      await updateChallengeStatus(challengeId, "settled", { payoutTxHashes: [txHash] });
      logger.info("Payout complete via escrow contract", { challengeId, txHash });
      return;
    } catch (error) {
      logger.error("Escrow settlement failed, falling back to direct payout", {
        challengeId,
        error: (error as Error).message,
      });
    }
  }

  // Fallback: direct payout via hot-wallet.
  let batchResults;
  try {
    batchResults = await submitBatchPayout(
      recipients,
      config.HOT_WALLET_SECRET,
      challengeId,
      network,
      {
        sequenceStore: stellarSequenceStore,
        onInvalidRecipient: (recipient, reason) => {
          logger.error("Invalid payout recipient skipped", {
            challengeId,
            address: recipient.address,
            amount: recipient.amount,
            reason,
          });
        },
      },
    );
  } catch (error) {
    if (isInsufficientFeeError(error)) {
      logger.warn("Insufficient fee error detected; fee bump recovery may be needed", {
        challengeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (isRetriableStellarError(error)) {
      logger.warn("Retriable Stellar payout error; allowing BullMQ retry", {
        challengeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }

  const txHashes: string[] = [];
  let hasFailure = false;

  for (const result of batchResults) {
    const status = result.success ? "sent" : "failed";
    if (!result.success) hasFailure = true;

    const errorMessage = !result.success
      ? (result.error ?? "Stellar broadcast failed with no error detail")
      : undefined;

    for (const recipient of result.recipients) {
      const record = payoutRecords.find((c) => c.address === recipient.address);
      if (!record) continue;

      await updatePayoutStatus(record.id, status, result.txHash || undefined, errorMessage);
      if (result.success) {
        await incrementUserEarnings(record.userId, record.amount);
      }
    }

    if (result.success) {
      txHashes.push(result.txHash);
      for (const recipient of result.recipients) {
        const record = payoutRecords.find((c) => c.address === recipient.address);
        if (!record) continue;
        await queueReferralBonusForPayout({
          referredUserId: record.userId,
          challengeId,
          referralWinAmountStroops: record.amountStroops,
        });
      }
    }
  }

  await updateChallengeStatus(
    challengeId,
    hasFailure ? "payout_failed" : "settled",
    txHashes.length > 0 ? { payoutTxHashes: txHashes } : undefined,
  );

  if (hasFailure) {
    logger.warn("Payout completed with failures", { challengeId, txHashes });
  } else {
    logger.info("Payout complete via direct transfer", { challengeId, txHashes });
  }
}

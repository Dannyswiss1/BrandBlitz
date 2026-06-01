import {
  isRetriableStellarError,
  submitBatchPayout,
  type PayoutRecipient,
} from "@brandblitz/stellar";
import type { NetworkName } from "@brandblitz/stellar";
import { getLeaderboard } from "../db/queries/sessions";
import { getChallengeById, updateChallengeStatus } from "../db/queries/challenges";
import { createPayout, updatePayoutStatus } from "../db/queries/payouts";
import { calculatePayoutShare, rankWinners } from "./scoring";
import { payoutJobOptions, payoutQueue } from "../queues/payout.queue";
import { logger } from "../lib/logger";
import { config } from "../lib/config";

/**
 * Enqueue a payout job for a completed challenge.
 * The actual Stellar transactions are processed by the BullMQ worker.
 */
export async function enqueuePayout(challengeId: string): Promise<void> {
  await payoutQueue.add(
    "process-payout",
    { challengeId },
    payoutJobOptions
  );
  logger.info("Payout job enqueued", { challengeId });
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

  const sessions = await getLeaderboard(challengeId, 1000); // all ranked sessions
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
    }))
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
  const payoutRecords: { id: string; address: string; amount: string }[] = [];

  for (const winner of eligibleWinners) {
    const amount = calculatePayoutShare(
      winner.totalScore,
      totalPoints,
      challenge.pool_amount_usdc
    );

    if (parseFloat(amount) < 0.0000001) {
      continue;
    }

    const payout = await createPayout({
      challengeId,
      userId: winner.userId,
      stellarAddress: winner.stellarAddress,
      amountUsdc: amount,
    });

    recipients.push({ address: winner.stellarAddress, amount });
    payoutRecords.push({ id: payout.id, address: winner.stellarAddress, amount });
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
  let results;
  try {
    results = await submitBatchPayout(
      recipients,
      config.HOT_WALLET_SECRET,
      challengeId,
      network,
      {
        onInvalidRecipient: (recipient, reason) => {
          logger.error("Invalid payout recipient skipped", {
            challengeId,
            address: recipient.address,
            amount: recipient.amount,
            reason,
          });
        },
      }
    );
  } catch (error) {
    if (isRetriableStellarError(error)) {
      logger.warn("Retriable Stellar payout error; allowing BullMQ retry", {
        challengeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    throw error;
  }

  const txHashes: string[] = [];
  let hasFailure = false;

  for (const result of results) {
    const status = result.success ? "sent" : "failed";
    if (!result.success) {
      hasFailure = true;
    }

    for (const recipient of result.recipients) {
      const record = payoutRecords.find((candidate) => candidate.address === recipient.address);
      if (record) {
        await updatePayoutStatus(
          record.id,
          status,
          result.txHash || undefined,
          result.success ? undefined : result.error
        );
      }
    }

    if (result.success) {
      txHashes.push(result.txHash);
    }
  }

  await updateChallengeStatus(
    challengeId,
    hasFailure ? "payout_failed" : "settled",
    txHashes.length > 0 ? { payoutTxHashes: txHashes } : undefined
  );

  if (hasFailure) {
    logger.warn("Payout completed with failures", { challengeId, txHashes });
    return;
  }

  logger.info("Payout complete", { challengeId, txHashes });
}

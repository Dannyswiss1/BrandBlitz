import { Worker, type Job } from "bullmq";
import { submitBatchPayout } from "@brandblitz/stellar";
import { config } from "../../lib/config";
import { logger } from "../../lib/logger";
import { stellarSequenceStore } from "../../lib/redis";
import {
  findReferralPayoutById,
  updateReferralPayoutStatus,
} from "../../db/queries/referral-payouts";
import { referralBonusQueue } from "../referral-bonus.queue";

export const referralBonusWorkerOptions = {
  concurrency: 2,
} as const;

async function processReferralBonusJob(
  job: Job<{ referralPayoutId: string }>,
): Promise<void> {
  const payout = await findReferralPayoutById(job.data.referralPayoutId);
  if (!payout) {
    logger.warn("Referral payout not found", {
      referralPayoutId: job.data.referralPayoutId,
    });
    return;
  }

  if (payout.status !== "pending") {
    logger.info("Referral payout already processed", {
      referralPayoutId: payout.id,
      status: payout.status,
    });
    return;
  }

  if (!payout.referrer_stellar_address || !payout.referred_stellar_address) {
    await updateReferralPayoutStatus(
      payout.id,
      "failed",
      undefined,
      "Missing Stellar address for referral bonus payout",
    );
    return;
  }

  const results = await submitBatchPayout(
    [
      {
        address: payout.referrer_stellar_address,
        amount: payout.referrer_amount_stroops,
      },
      {
        address: payout.referred_stellar_address,
        amount: payout.referred_amount_stroops,
      },
    ],
    config.HOT_WALLET_SECRET,
    `referral-${payout.id}`,
    config.STELLAR_NETWORK,
    { sequenceStore: stellarSequenceStore },
  );

  const firstResult = results[0];
  if (!firstResult) {
    await updateReferralPayoutStatus(
      payout.id,
      "failed",
      undefined,
      "No Stellar response",
    );
    return;
  }

  if (firstResult.success) {
    await updateReferralPayoutStatus(payout.id, "sent", firstResult.txHash);
    logger.info("Referral bonus payout completed", {
      referralPayoutId: payout.id,
      txHash: firstResult.txHash,
    });
    return;
  }

  await updateReferralPayoutStatus(
    payout.id,
    "failed",
    undefined,
    firstResult.error ?? "Referral bonus payout failed",
  );
}

export function createReferralBonusWorker(
  WorkerImpl: typeof Worker = Worker,
): Worker {
  return new WorkerImpl(
    referralBonusQueue.name,
    processReferralBonusJob,
    referralBonusWorkerOptions,
  );
}

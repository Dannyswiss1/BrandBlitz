import { Queue, type JobsOptions } from "bullmq";
import { redis } from "../lib/redis";

export const referralBonusJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
} satisfies JobsOptions;

export const referralBonusQueue = new Queue("referral-bonus", {
  connection: redis,
  defaultJobOptions: referralBonusJobOptions,
});

export async function enqueueReferralBonus(
  referralPayoutId: string,
): Promise<void> {
  await referralBonusQueue.add(
    "process-referral-bonus",
    { referralPayoutId },
    referralBonusJobOptions,
  );
}

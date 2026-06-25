import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueuePayoutJob, payoutQueue } from "./payout.queue";

describe("payout queue deduplication", () => {
  beforeAll(async () => {
    await payoutQueue.obliterate({ force: true });
  });

  afterAll(async () => {
    await payoutQueue.close();
  });

  it("adding duplicate job with same challenge_id results in exactly one job", async () => {
    const challengeId = "challenge-dedup-test-1";

    await enqueuePayoutJob(challengeId);
    await enqueuePayoutJob(challengeId);
    await enqueuePayoutJob(challengeId);

    const jobs = await payoutQueue.getJobs(["waiting", "active"]);
    const matchingJobs = jobs.filter((j) => j.data.challengeId === challengeId);

    expect(matchingJobs).toHaveLength(1);
    expect(matchingJobs[0]?.id).toBe(`payout:${challengeId}`);

    // Cleanup
    await payoutQueue.obliterate({ force: true });
  });

  it("different challenge_ids create separate jobs", async () => {
    await enqueuePayoutJob("challenge-A");
    await enqueuePayoutJob("challenge-B");

    const jobs = await payoutQueue.getJobs(["waiting", "active"]);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id).sort()).toEqual([
      "payout:challenge-A",
      "payout:challenge-B",
    ]);

    // Cleanup
    await payoutQueue.obliterate({ force: true });
  });
});

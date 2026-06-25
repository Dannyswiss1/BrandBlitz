import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAYOUT_WORKER_CONCURRENCY,
  createPayoutWorker,
  payoutWorkerOptions,
  handleExhaustedPayoutJob,
  processPayoutJob,
} from "./payout.processor";
import { payoutJobOptions } from "../payout.queue";

const mocks = vi.hoisted(() => ({
  processPayout: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  failPayoutsForChallenge: vi.fn(),
  query: vi.fn(),
}));

vi.mock("../../services/payout", () => ({
  processPayout: mocks.processPayout,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
  },
}));

vi.mock("../../lib/redis", () => ({
  redis: {},
}));

vi.mock("../../db/queries/payouts", () => ({
  failPayoutsForChallenge: mocks.failPayoutsForChallenge,
}));

vi.mock("../../db", () => ({
  query: mocks.query,
}));

type PayoutJobData = { challengeId: string; requestId?: string };

class FakeWorker {
  readonly queueName: string;
  readonly processor: (job: Job<PayoutJobData>) => Promise<void>;
  readonly options: typeof payoutWorkerOptions;
  readonly handlers = new Map<string, (...args: unknown[]) => void>();

  constructor(
    queueName: string,
    processor: (job: Job<PayoutJobData>) => Promise<void>,
    options: typeof payoutWorkerOptions
  ) {
    this.queueName = queueName;
    this.processor = processor;
    this.options = options;
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    this.handlers.set(event, handler);
    return this;
  }
}

function makeJob(id: string, challengeId: string, attemptsMade = 0): Job<PayoutJobData> {
  return {
    id,
    data: { challengeId },
    attemptsMade,
  } as Job<PayoutJobData>;
}

async function runWithRetries(
  processor: (job: Job<PayoutJobData>) => Promise<void>,
  job: Job<PayoutJobData>,
  attempts: number
): Promise<{ attemptsMade: number; error?: Error }> {
  let attemptsMade = 0;

  while (attemptsMade < attempts) {
    try {
      await processor({ ...job, attemptsMade } as Job<PayoutJobData>);
      return { attemptsMade: attemptsMade + 1 };
    } catch (error) {
      attemptsMade += 1;
      if (attemptsMade >= attempts) {
        return { attemptsMade, error: error as Error };
      }
    }
  }

  return { attemptsMade };
}

async function runWithConcurrency(
  processor: (job: Job<PayoutJobData>) => Promise<void>,
  jobs: Job<PayoutJobData>[],
  concurrency: number
): Promise<{ maxInFlight: number }> {
  let maxInFlight = 0;
  let inFlight = 0;
  const queue = [...jobs];

  async function workerLoop(): Promise<void> {
    while (queue.length > 0) {
      const nextJob = queue.shift();
      if (!nextJob) return;

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      try {
        await processor(nextJob);
      } finally {
        inFlight -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  return { maxInFlight };
}

describe("payout processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits processPayout with the challengeId from the job", async () => {
    const deferred = Promise.resolve();
    mocks.processPayout.mockReturnValue(deferred);

    await processPayoutJob(makeJob("job-1", "challenge-1"));

    expect(mocks.processPayout).toHaveBeenCalledWith("challenge-1");
    expect(mocks.loggerInfo).toHaveBeenCalledWith("Processing payout job", {
      jobId: "job-1",
      challengeId: "challenge-1",
    });
  });

  it("creates a worker with queue name payout and concurrency 2", () => {
    const worker = createPayoutWorker(FakeWorker as unknown as typeof import("bullmq").Worker);

    expect(worker).toBeInstanceOf(FakeWorker);
    expect((worker as unknown as FakeWorker).queueName).toBe("payout");
    expect((worker as unknown as FakeWorker).options.concurrency).toBe(
      PAYOUT_WORKER_CONCURRENCY
    );
  });

  it("logs completion and failure events from the worker", () => {
    const worker = createPayoutWorker(FakeWorker as unknown as typeof import("bullmq").Worker);
    const fakeWorker = worker as unknown as FakeWorker;

    fakeWorker.handlers.get("completed")?.(makeJob("job-1", "challenge-1"));
    fakeWorker.handlers
      .get("failed")
      ?.(
        makeJob("job-2", "challenge-2", 2),
        new Error("processor failed")
      );

    expect(mocks.loggerInfo).toHaveBeenCalledWith("Payout job completed", { jobId: "job-1" });
    expect(mocks.loggerError).toHaveBeenCalledWith("Payout job failed", {
      jobId: "job-2",
      error: "processor failed",
      attempts: 2,
    });
  });

  it("retries a failing job according to the configured attempts", async () => {
    mocks.processPayout.mockRejectedValue(new Error("boom"));

    const result = await runWithRetries(
      processPayoutJob,
      makeJob("job-1", "challenge-1"),
      payoutJobOptions.attempts ?? 1
    );

    expect(mocks.processPayout).toHaveBeenCalledTimes(5);
    expect(result.attemptsMade).toBe(5);
    expect(result.error?.message).toBe("boom");
  });

  it("rethrows retriable Stellar network errors so BullMQ marks the job failed", async () => {
    const networkError = Object.assign(new Error("Horizon timeout"), {
      name: "NetworkError",
    });
    mocks.processPayout.mockRejectedValue(networkError);

    await expect(processPayoutJob(makeJob("job-1", "challenge-1"))).rejects.toBe(
      networkError
    );
  });

  it("marks pending payouts failed and writes audit log after retries are exhausted", async () => {
    const job = makeJob("job-1", "challenge-1", 5);
    const err = new Error("Horizon timeout");

    await handleExhaustedPayoutJob(job, err);

    expect(mocks.failPayoutsForChallenge).toHaveBeenCalledWith(
      "challenge-1",
      "Horizon timeout"
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      [
        "payout_failed",
        "challenge",
        "challenge-1",
        JSON.stringify({
          jobId: "job-1",
          attemptsMade: 5,
          error: "Horizon timeout",
        }),
      ]
    );
  });

  it("limits processing to two jobs in flight at a time", async () => {
    const pendingResolvers: Array<() => void> = [];
    mocks.processPayout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        })
    );

    const concurrencyRun = runWithConcurrency(
      processPayoutJob,
      Array.from({ length: 10 }, (_, index) => makeJob(`job-${index}`, `challenge-${index}`)),
      PAYOUT_WORKER_CONCURRENCY
    );

    await Promise.resolve();
    await Promise.resolve();

    const { maxInFlight } = await (async () => {
      while (pendingResolvers.length < PAYOUT_WORKER_CONCURRENCY) {
        await Promise.resolve();
      }

      while (pendingResolvers.length > 0) {
        const resolveNext = pendingResolvers.shift();
        resolveNext?.();
        await Promise.resolve();
      }

      return concurrencyRun;
    })();

    expect(maxInFlight).toBe(2);
  });

  it("exposes queue defaults for retry, backoff, and cleanup policy", () => {
    expect(payoutJobOptions).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });
    expect(payoutWorkerOptions.concurrency).toBe(2);
  });
});

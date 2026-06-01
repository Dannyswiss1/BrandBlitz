import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SequenceStore } from "./sequence";

const mocks = vi.hoisted(() => {
  const submitTransactionMock = vi.fn();
  const loadAccountMock = vi.fn();
  const paymentMock = vi.fn((operation) => operation);
  const memoTextMock = vi.fn((value: string) => value);

  class MockAccount {
    constructor(
      public readonly accountId: string,
      private sequence: string
    ) {}

    sequenceNumber(): string {
      return this.sequence;
    }

    incrementSequenceNumber(): void {
      this.sequence = (BigInt(this.sequence) + 1n).toString();
    }
  }

  class MockTransactionBuilder {
    static sourceSequences: string[] = [];
    static operationCounts: number[] = [];

    private operations = 0;

    constructor(private readonly source: MockAccount) {}

    addMemo(): this {
      return this;
    }

    setTimeout(): this {
      return this;
    }

    addOperation(): this {
      this.operations += 1;
      return this;
    }

    build() {
      MockTransactionBuilder.sourceSequences.push(this.source.sequenceNumber());
      MockTransactionBuilder.operationCounts.push(this.operations);
      return {
        sign: vi.fn(),
      };
    }
  }

  return {
    MockAccount,
    MockTransactionBuilder,
    loadAccountMock,
    memoTextMock,
    paymentMock,
    submitTransactionMock,
  };
});

vi.mock("./client", () => ({
  getHorizonServer: vi.fn(() => ({
    loadAccount: mocks.loadAccountMock,
    submitTransaction: mocks.submitTransactionMock,
  })),
  getUsdcAsset: vi.fn(() => "USDC"),
  getNetworkPassphrase: vi.fn(() => "Test Network"),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Account: mocks.MockAccount,
  Keypair: {
    fromSecret: vi.fn(() => ({
      publicKey: () => "GTESTPUBLICKEY",
    })),
  },
  TransactionBuilder: mocks.MockTransactionBuilder,
  Operation: {
    payment: mocks.paymentMock,
  },
  Memo: {
    text: mocks.memoTextMock,
  },
  BASE_FEE: "100",
}));

import { isRetriableStellarError, submitBatchPayout } from "./payout";

class InMemorySequenceStore implements SequenceStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, next.toString());
    return next;
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    if (this.values.has(key)) {
      return false;
    }

    this.values.set(key, value);
    return true;
  }
}

describe("submitBatchPayout", () => {
  beforeEach(() => {
    mocks.MockTransactionBuilder.sourceSequences = [];
    mocks.MockTransactionBuilder.operationCounts = [];
    vi.clearAllMocks();
    mocks.loadAccountMock.mockResolvedValue(new mocks.MockAccount("GTESTPUBLICKEY", "100"));
    mocks.submitTransactionMock.mockImplementation(async () => ({
      hash: `tx-${mocks.submitTransactionMock.mock.calls.length}`,
    }));
  });

  it("submits a one-recipient payload as one transaction with one operation", async () => {
    const recipients = [{ address: "GDESTINATION1", amount: "1.0000000" }];

    const results = await submitBatchPayout(recipients, "SSECRET", "challenge-1");

    expect(mocks.submitTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.paymentMock).toHaveBeenCalledTimes(1);
    expect(mocks.MockTransactionBuilder.operationCounts).toEqual([1]);
    expect(results).toEqual([
      {
        txHash: "tx-1",
        recipients,
        success: true,
      },
    ]);
  });

  it("submits 51 recipients as two transactions with chunk sizes 50 and 1", async () => {
    const recipients = buildRecipients(51);

    const results = await submitBatchPayout(
      recipients,
      "SSECRET",
      "challenge-51",
      "testnet",
      { sequenceStore: new InMemorySequenceStore() }
    );

    expect(mocks.submitTransactionMock).toHaveBeenCalledTimes(2);
    expect(mocks.MockTransactionBuilder.operationCounts).toEqual([50, 1]);
    expect(results.map((result) => result.recipients)).toEqual([
      recipients.slice(0, 50),
      recipients.slice(50),
    ]);
  });

  it("submits 250 recipients as five transactions", async () => {
    const recipients = buildRecipients(250);

    const results = await submitBatchPayout(
      recipients,
      "SSECRET",
      "challenge-250",
      "testnet",
      { sequenceStore: new InMemorySequenceStore() }
    );

    expect(mocks.submitTransactionMock).toHaveBeenCalledTimes(5);
    expect(mocks.MockTransactionBuilder.operationCounts).toEqual([50, 50, 50, 50, 50]);
    expect(results).toHaveLength(5);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it("skips recipients with bad amounts, logs clearly, and continues the batch", async () => {
    const onInvalidRecipient = vi.fn();
    const valid = { address: "GVALID", amount: "2.5000000" };
    const invalid = { address: "GINVALID", amount: "-1.0000000" };

    const results = await submitBatchPayout(
      [invalid, valid],
      "SSECRET",
      "challenge-skip",
      "testnet",
      { onInvalidRecipient }
    );

    expect(onInvalidRecipient).toHaveBeenCalledWith(
      invalid,
      "amount must be a positive Stellar amount with up to 7 decimal places"
    );
    expect(mocks.paymentMock).toHaveBeenCalledTimes(1);
    expect(mocks.submitTransactionMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        txHash: "tx-1",
        recipients: [valid],
        success: true,
      },
    ]);
  });

  it("resets the reserved sequence and retries once on tx_bad_seq", async () => {
    const store = new InMemorySequenceStore();
    const onSequenceReset = vi.fn();

    mocks.loadAccountMock
      .mockResolvedValueOnce(new mocks.MockAccount("GTESTPUBLICKEY", "100"))
      .mockResolvedValueOnce(new mocks.MockAccount("GTESTPUBLICKEY", "101"));

    mocks.submitTransactionMock
      .mockRejectedValueOnce({
        message: "tx_bad_seq",
        response: {
          data: {
            extras: {
              result_codes: {
                transaction: "tx_bad_seq",
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ hash: "tx-success" });

    const results = await submitBatchPayout(
      [{ address: "GDESTINATION", amount: "1.0000000" }],
      "SSECRET",
      "challenge-123",
      "testnet",
      {
        sequenceStore: store,
        onSequenceReset,
      }
    );

    expect(results).toEqual([
      {
        txHash: "tx-success",
        recipients: [{ address: "GDESTINATION", amount: "1.0000000" }],
        success: true,
      },
    ]);
    expect(mocks.submitTransactionMock).toHaveBeenCalledTimes(2);
    expect(onSequenceReset).toHaveBeenCalledTimes(1);
    expect(mocks.MockTransactionBuilder.sourceSequences).toEqual(["100", "101"]);
  });

  it("identifies Stellar network and timeout errors as retriable", () => {
    expect(isRetriableStellarError({ code: "ECONNABORTED" })).toBe(true);
    expect(isRetriableStellarError({ name: "NetworkError" })).toBe(true);
    expect(isRetriableStellarError({ name: "TimeoutError" })).toBe(true);
    expect(isRetriableStellarError(new Error("transaction failed"))).toBe(false);
  });
});

function buildRecipients(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    address: `GDESTINATION${index}`,
    amount: "1.0000000",
  }));
}

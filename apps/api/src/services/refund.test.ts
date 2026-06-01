import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRefundByChallengeId: vi.fn(),
  createRefund: vi.fn(),
  getChallengeById: vi.fn(),
  updateChallengeStatus: vi.fn(),
  query: vi.fn(),
  forTransaction: vi.fn(),
  submitTransaction: vi.fn(),
}));

vi.mock("../db/queries/refunds", () => ({
  findRefundByChallengeId: mocks.findRefundByChallengeId,
  createRefund: mocks.createRefund,
}));

vi.mock("../db/queries/challenges", () => ({
  getChallengeById: mocks.getChallengeById,
  updateChallengeStatus: mocks.updateChallengeStatus,
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../lib/config", () => ({
  config: {
    STELLAR_NETWORK: "testnet",
    HOT_WALLET_SECRET: "test-hot-wallet-secret",
  },
}));

vi.mock("@brandblitz/stellar", () => ({
  getHorizonServer: () => ({
    operations: () => ({
      forTransaction: mocks.forTransaction,
    }),
    loadAccount: vi.fn().mockResolvedValue({ sequenceNumber: () => "1" }),
    submitTransaction: mocks.submitTransaction,
  }),
  getNetworkPassphrase: () => "Test SDF Network ; September 2015",
  getUsdcAsset: () => ({ code: "USDC", issuer: "GISSUER" }),
}));

vi.mock("@stellar/stellar-sdk", () => {
  class FakeTransactionBuilder {
    addMemo() {
      return this;
    }
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign: vi.fn() };
    }
  }

  return {
    Account: class FakeAccount {
      constructor(_accountId: string, _sequence: string) {}
    },
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GHOT", sign: vi.fn() }),
    },
    TransactionBuilder: FakeTransactionBuilder,
    Operation: { payment: vi.fn((op) => op) },
    Memo: { text: vi.fn((text) => ({ text })) },
    BASE_FEE: "100",
  };
});

import { refundChallenge } from "./refund";

describe("refundChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRefundByChallengeId.mockResolvedValue(null);
    mocks.forTransaction.mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [{ type: "payment", from: "GBRAND" }],
      }),
    });
    mocks.submitTransaction.mockResolvedValue({ hash: "refund-tx" });
    mocks.createRefund.mockResolvedValue({
      id: "refund-1",
      challenge_id: "00000000-0000-0000-0000-000000000001",
      tx_hash: "refund-tx",
    });
  });

  it("refunds a deposited challenge and marks it refunded", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });

    const refund = await refundChallenge({
      challengeId: "00000000-0000-0000-0000-000000000001",
      adminId: "admin-1",
      reason: "brand requested cancellation",
    });

    expect(refund.tx_hash).toBe("refund-tx");
    expect(mocks.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "GBRAND",
        amountStroops: "2500000",
        txHash: "refund-tx",
      })
    );
    expect(mocks.updateChallengeStatus).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "refunded"
    );
    expect(mocks.query).toHaveBeenCalled();
  });

  it("rejects an already-settled challenge", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "settled",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("Challenge already settled");
  });

  it("rejects when no deposit is found", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: null,
      pool_amount_stroops: "2500000",
    });

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("No deposit found");
  });
});

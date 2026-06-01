import {
  Account,
  Keypair,
  TransactionBuilder,
  Operation,
  Memo,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { getHorizonServer, getUsdcAsset, getNetworkPassphrase, type NetworkName } from "./client";
import { MAX_OPS_PER_TX, PAYOUT_BATCH_DELAY_MS } from "./constants";
import {
  buildSequenceKeyPrefix,
  reserveSequence,
  resetSequence,
  type SequenceResetInfo,
  type SequenceStore,
} from "./sequence";

export interface PayoutRecipient {
  address: string;
  amount: string; // in USDC, e.g. "10.5000000"
}

export interface PayoutBatchResult {
  txHash: string;
  recipients: PayoutRecipient[];
  success: boolean;
  error?: string;
}

export interface SubmitBatchPayoutOptions {
  sequenceStore?: SequenceStore;
  onSequenceReset?: (info: SequenceResetInfo) => void | Promise<void>;
  maxBadSeqRetries?: number;
  onInvalidRecipient?: (recipient: PayoutRecipient, reason: string) => void;
}

/**
 * Build and submit a batch payout transaction.
 * Up to MAX_OPS_PER_TX (50) Payment operations per transaction — atomic all-or-nothing.
 */
export async function submitBatchPayout(
  recipients: PayoutRecipient[],
  hotWalletSecret: string,
  challengeId: string,
  network: NetworkName = "testnet",
  options: SubmitBatchPayoutOptions = {}
): Promise<PayoutBatchResult[]> {
  if (recipients.length === 0) return [];

  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);
  const passphrase = getNetworkPassphrase(network);
  const hotKeypair = Keypair.fromSecret(hotWalletSecret);
  const sequenceKeyPrefix = buildSequenceKeyPrefix(network, hotKeypair.publicKey());
  const maxBadSeqRetries = options.maxBadSeqRetries ?? 1;

  const loadBaseSequence = async () => {
    const account = await horizon.loadAccount(hotKeypair.publicKey());
    return account.sequenceNumber();
  };

  const validRecipients = recipients.filter((recipient) => {
    const reason = getInvalidRecipientReason(recipient);
    if (!reason) return true;

    if (options.onInvalidRecipient) {
      options.onInvalidRecipient(recipient, reason);
    } else {
      console.warn("Skipping invalid payout recipient", { recipient, reason });
    }

    return false;
  });

  if (validRecipients.length === 0) return [];

  const results: PayoutBatchResult[] = [];
  const batches = chunkArray(validRecipients, MAX_OPS_PER_TX);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let attempts = 0;

    while (attempts <= maxBadSeqRetries) {
      try {
        const sourceAccount = options.sequenceStore
          ? new Account(
              hotKeypair.publicKey(),
              (
                await reserveSequence({
                  store: options.sequenceStore,
                  keyPrefix: sequenceKeyPrefix,
                  loadBaseSequence,
                })
              ).accountSequence
            )
          : await horizon.loadAccount(hotKeypair.publicKey());

        const tx = new TransactionBuilder(sourceAccount, {
          fee: BASE_FEE,
          networkPassphrase: passphrase,
        })
          .addMemo(Memo.text(buildPayoutMemo(challengeId, i)))
          .setTimeout(180);

        for (const recipient of batch) {
          tx.addOperation(
            Operation.payment({
              destination: recipient.address,
              asset: usdc,
              amount: recipient.amount,
            })
          );
        }

        const builtTx = tx.build();
        builtTx.sign(hotKeypair);

        const response = await horizon.submitTransaction(builtTx);

        results.push({
          txHash: response.hash,
          recipients: batch,
          success: true,
        });

        break;
      } catch (err: any) {
        if (
          options.sequenceStore &&
          isBadSequenceError(err) &&
          attempts < maxBadSeqRetries
        ) {
          attempts += 1;
          await resetSequence({
            store: options.sequenceStore,
            keyPrefix: sequenceKeyPrefix,
            loadBaseSequence,
            reason: "tx_bad_seq",
            onReset: options.onSequenceReset,
          });
          continue;
        }

        results.push({
          txHash: "",
          recipients: batch,
          success: false,
          error: err?.message ?? "Unknown error",
        });
        break;
      }
    }

    if (!options.sequenceStore && i < batches.length - 1) {
      await delay(PAYOUT_BATCH_DELAY_MS);
    }
  }

  return results;
}

/**
 * Build a deterministic payout memo that respects Stellar's 28-byte text memo limit.
 */
function buildPayoutMemo(challengeId: string, batchIndex: number): string {
  const challengeTag = challengeId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
  return `bb-${challengeTag}-${batchIndex}`;
}

function isBadSequenceError(err: unknown): boolean {
  const txCode =
    (err as any)?.response?.data?.extras?.result_codes?.transaction ??
    (err as any)?.data?.extras?.result_codes?.transaction;

  return txCode === "tx_bad_seq" || String((err as any)?.message ?? "").includes("tx_bad_seq");
}

export function isRetriableStellarError(err: unknown): boolean {
  const code = (err as any)?.code;
  const name = (err as any)?.name;
  const message = String((err as any)?.message ?? "").toLowerCase();

  return (
    code === "ECONNABORTED" ||
    name === "NetworkError" ||
    name === "TimeoutError" ||
    message.includes("networkerror") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

function getInvalidRecipientReason(recipient: PayoutRecipient): string | null {
  if (!recipient.address) {
    return "missing address";
  }

  if (!isValidStellarAmount(recipient.amount)) {
    return "amount must be a positive Stellar amount with up to 7 decimal places";
  }

  return null;
}

function isValidStellarAmount(amount: string): boolean {
  if (!/^\d+(?:\.\d{1,7})?$/.test(amount)) {
    return false;
  }

  return Number(amount) > 0;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

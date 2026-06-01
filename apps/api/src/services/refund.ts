import {
  getHorizonServer,
  getNetworkPassphrase,
  getUsdcAsset,
  type NetworkName,
} from "@brandblitz/stellar";
import {
  Account,
  Keypair,
  TransactionBuilder,
  Operation,
  Memo,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { getChallengeById, updateChallengeStatus } from "../db/queries/challenges";
import { createRefund, findRefundByChallengeId } from "../db/queries/refunds";
import { stroopsToUsdc } from "../lib/usdc";
import { config } from "../lib/config";
import { query } from "../db";

export async function refundChallenge(data: {
  challengeId: string;
  adminId: string;
  reason: string;
}) {
  const existingRefund = await findRefundByChallengeId(data.challengeId);
  if (existingRefund) return existingRefund;

  const challenge = await getChallengeById(data.challengeId);
  if (!challenge) throw new Error("Challenge not found");
  if (challenge.status === "settled") throw new Error("Challenge already settled");
  if (!challenge.deposit_tx_hash) throw new Error("No deposit found");

  const destination = await getDepositSender(
    challenge.deposit_tx_hash,
    config.STELLAR_NETWORK as NetworkName
  );
  if (!destination) throw new Error("No deposit found");

  const amount = stroopsToUsdc(challenge.pool_amount_stroops);
  const txHash = await submitRefundPayment({
    destination,
    amount,
    challengeId: challenge.id,
    hotWalletSecret: config.HOT_WALLET_SECRET,
    network: config.STELLAR_NETWORK as NetworkName,
  });

  const refund = await createRefund({
    challengeId: challenge.id,
    adminId: data.adminId,
    reason: data.reason,
    amountStroops: challenge.pool_amount_stroops,
    destination,
    txHash,
  });

  await updateChallengeStatus(challenge.id, "refunded");
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, 'challenge_refund', 'challenge', $2, $3)`,
    [
      data.adminId,
      challenge.id,
      JSON.stringify({ refundId: refund.id, txHash, amount, destination, reason: data.reason }),
    ]
  );

  return refund;
}

async function getDepositSender(txHash: string, network: NetworkName): Promise<string | null> {
  const horizon = getHorizonServer(network);
  const operations = await horizon.operations().forTransaction(txHash).call();
  const payment = operations.records.find((op: any) => op.type === "payment");
  return (payment as any)?.from ?? (payment as any)?.source_account ?? null;
}

async function submitRefundPayment(data: {
  destination: string;
  amount: string;
  challengeId: string;
  hotWalletSecret: string;
  network: NetworkName;
}): Promise<string> {
  const horizon = getHorizonServer(data.network);
  const hotKeypair = Keypair.fromSecret(data.hotWalletSecret);
  const source = await horizon.loadAccount(hotKeypair.publicKey());
  const account = new Account(hotKeypair.publicKey(), source.sequenceNumber());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(data.network),
  })
    .addMemo(Memo.text(`REFUND:${data.challengeId.slice(0, 21)}`))
    .addOperation(
      Operation.payment({
        destination: data.destination,
        asset: getUsdcAsset(data.network),
        amount: data.amount,
      })
    )
    .setTimeout(180)
    .build();

  tx.sign(hotKeypair);
  const response = await horizon.submitTransaction(tx);
  return response.hash;
}

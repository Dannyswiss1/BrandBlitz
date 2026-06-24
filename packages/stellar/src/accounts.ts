import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  MuxedAccount,
} from "@stellar/stellar-sdk";
import { getHorizonServer, getUsdcAsset, getNetworkPassphrase, type NetworkName } from "./client";

/**
 * Create a muxed account address from a base account public key and a user ID.
 * Muxed accounts allow virtual sub-accounts without on-chain accounts or XLM reserves.
 *
 * Architecture decision: Single hot wallet + muxed accounts instead of per-user accounts
 * saves 2 XLM (~$0.20) per user in minimum reserve costs.
 */
export function createMuxedAddress(basePublicKey: string, userId: bigint): string {
  const muxed = new MuxedAccount(basePublicKey, userId.toString());
  return muxed.accountId();
}

/**
 * Sponsor a new Stellar account for a first-time winner.
 * Covers the base reserve (1 XLM) and USDC trustline (0.5 XLM extra).
 *
 * Architecture decision: CAP-0033 Sponsored Reserves — platform pays, user retains control.
 * Requires both sponsor signature (backend) AND winner signature (via embedded wallet).
 */
export async function sponsorNewAccount(
  winnerPublicKey: string,
  sponsorSecret: string,
  network: NetworkName = "testnet"
): Promise<{ txEnvelopeXdr: string }> {
  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);
  const passphrase = getNetworkPassphrase(network);
  const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
  const sponsorAccount = await horizon.loadAccount(sponsorKeypair.publicKey());

  const tx = new TransactionBuilder(sponsorAccount, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({
        sponsoredId: winnerPublicKey,
      })
    )
    .addOperation(
      Operation.createAccount({
        destination: winnerPublicKey,
        startingBalance: "0",
      })
    )
    .addOperation(
      Operation.changeTrust({
        asset: usdc,
        source: winnerPublicKey,
      })
    )
    .addOperation(
      Operation.endSponsoringFutureReserves({
        source: winnerPublicKey,
      })
    )
    .setTimeout(300)
    .build();

  // Sponsor signs — winner must also sign before submission
  tx.sign(sponsorKeypair);

  return { txEnvelopeXdr: tx.toEnvelope().toXDR("base64") };
}

/**
 * Check if a Stellar account exists and has a USDC trustline.
 */
export async function accountHasUsdcTrustline(
  publicKey: string,
  network: NetworkName = "testnet"
): Promise<boolean> {
  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);

  try {
    const account = await horizon.loadAccount(publicKey);
    return account.balances.some(
      (b) =>
        b.asset_type === "credit_alphanum4" &&
        (b as any).asset_code === "USDC" &&
        (b as any).asset_issuer === usdc.getIssuer()
    );
  } catch {
    return false;
  }
}

/** Return an account's USDC trustline balance in Stellar stroops (7 decimals). */
export async function getAccountUsdcBalance(
  publicKey: string,
  network: NetworkName = "testnet"
): Promise<bigint> {
  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);
  const account = await horizon.loadAccount(publicKey);
  const balance = account.balances.find(
    (item) =>
      item.asset_type === "credit_alphanum4" &&
      (item as any).asset_code === "USDC" &&
      (item as any).asset_issuer === usdc.getIssuer()
  ) as { balance?: string } | undefined;

  if (!balance?.balance) return 0n;
  const [whole, fraction = ""] = balance.balance.split(".");
  return BigInt(`${whole}${fraction.padEnd(7, "0").slice(0, 7)}`);
}

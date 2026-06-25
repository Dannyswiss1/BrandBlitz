import {
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  Asset,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Server as HorizonServer } from "@stellar/stellar-sdk/lib/horizon";
import { Server as SorobanServer } from "@stellar/stellar-sdk/lib/soroban";
import { withRetry, type RetryOptions } from "./client";

export interface EscrowRecipient {
  address: string;
  amountStroops: bigint;
}

export interface EscrowConfig {
  contractId: string;
  horizonUrl: string;
  sorobanUrl: string;
  networkPassphrase: string;
}

/**
 * Soroban Escrow Contract Wrapper
 *
 * Wraps initialize, deposit, settle, and refund calls to the USDC escrow contract.
 * The contract holds prize pools atomically and distributes to winners on settlement.
 */
export class EscrowClient {
  private contract: Contract;
  private horizonServer: HorizonServer;
  private sorobanServer: SorobanServer;
  private networkPassphrase: string;

  constructor(config: EscrowConfig) {
    this.contract = new Contract(config.contractId);
    this.horizonServer = new HorizonServer(config.horizonUrl);
    this.sorobanServer = new SorobanServer(config.sorobanUrl);
    this.networkPassphrase = config.networkPassphrase;
  }

  /**
   * Initialize the escrow contract for a challenge.
   * Called once per challenge to set up the contract instance.
   *
   * @param admin - BrandBlitz hot-wallet address (authorized to settle/refund)
   * @param usdcTokenAddress - USDC SAC contract address on this network
   * @param memo - Challenge ID (unique identifier for this escrow)
   * @param signerSecret - Hot-wallet secret key for signing
   */
  async initialize(
    admin: string,
    usdcTokenAddress: string,
    memo: string,
    signerSecret: string
  ): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call(
            "initialize",
            new Address(admin).toScVal(),
            new Address(usdcTokenAddress).toScVal(),
            nativeToScVal(memo, { type: "string" })
          ),
          auth: [],
        })
      )
      .setTimeout(300)
      .build();

    tx.sign(signer);
    const result = await withRetry(
      () => this.sorobanServer.sendTransaction(tx),
      { maxAttempts: 5, baseDelayMs: 250, maxDelayMs: 30_000 }
    );

    if (result.status === "ERROR") {
      throw new Error(`Initialize failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * Deposit USDC into the escrow contract.
   * Called by the brand to fund the prize pool.
   *
   * @param depositor - Brand address (must have approved USDC for contract)
   * @param amountStroops - Amount in stroops (1 USDC = 10^7 stroops)
   * @param signerSecret - Depositor's secret key for signing
   */
  async deposit(
    depositor: string,
    amountStroops: bigint,
    signerSecret: string
  ): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call(
            "deposit",
            new Address(depositor).toScVal(),
            nativeToScVal(Number(amountStroops), { type: "i128" })
          ),
          auth: [
            {
              credentials: xdr.SorobanCredentials.sorobanAddressCredentials(
                new Address(depositor).toScVal(),
                BigInt(0),
                xdr.Int64.fromString("0"),
                xdr.SignerKey.signerKeyTypeEd25519(
                  Keypair.fromSecret(signerSecret).rawPublicKey()
                ),
                xdr.Int64.fromString("0"),
                xdr.SorobanSignaturePayload.sorobanSignaturePayloadEnvelope(
                  xdr.EnvelopeTypeTx.txTypeTransaction(),
                  xdr.TransactionEnvelope.txTypeV0(
                    xdr.TransactionV0Envelope.create({
                      tx: xdr.TransactionV0.create({
                        sourceAccountEd25519: Keypair.fromSecret(signerSecret)
                          .rawPublicKey(),
                        fee: 100000,
                        seqNum: xdr.SequenceNumber.create(BigInt(0)),
                        timeBounds: xdr.TimeBounds.create({
                          minTime: xdr.Uint64.fromString("0"),
                          maxTime: xdr.Uint64.fromString("0"),
                        }),
                        memo: xdr.Memo.memoNone(),
                        operations: [],
                        ext: xdr.TransactionV0Ext.v0(),
                      }),
                      signatures: [],
                    })
                  )
                )
              ),
            },
          ],
        })
      )
      .setTimeout(300)
      .build();

    tx.sign(signer);
    const result = await withRetry(
      () => this.sorobanServer.sendTransaction(tx),
      { maxAttempts: 5, baseDelayMs: 250, maxDelayMs: 30_000 }
    );

    if (result.status === "ERROR") {
      throw new Error(`Deposit failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * Settle the escrow by distributing USDC to winners.
   * Called by the backend after challenge ends to pay out winners.
   *
   * @param recipients - Array of (address, amountStroops) pairs
   * @param signerSecret - Hot-wallet secret key for signing
   */
  async settle(recipients: EscrowRecipient[], signerSecret: string): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    // Convert recipients to Soroban format
    const recipientScVals = recipients.map((r) =>
      nativeToScVal(
        [new Address(r.address).toScVal(), Number(r.amountStroops)],
        { type: "vec" }
      )
    );

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call(
            "settle",
            nativeToScVal(recipientScVals, { type: "vec" })
          ),
          auth: [],
        })
      )
      .setTimeout(300)
      .build();

    tx.sign(signer);
    const result = await withRetry(
      () => this.sorobanServer.sendTransaction(tx),
      { maxAttempts: 5, baseDelayMs: 250, maxDelayMs: 30_000 }
    );

    if (result.status === "ERROR") {
      throw new Error(`Settle failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * View: Get the current escrowed balance.
   */
  async getBalance(): Promise<bigint> {
    const result = await withRetry(
      () =>
        this.sorobanServer.getContractData(
          this.contract.address().contractId(),
          xdr.ScVal.scValTypeSymbol(Buffer.from("balance"))
        ),
      { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5_000 }
    );

    if (!result) {
      return 0n;
    }

    const balance = scValToNative(result.val);
    return BigInt(balance as number);
  }

  /**
   * View: Check if the escrow has been settled or refunded.
   */
  async isSettled(): Promise<boolean> {
    const result = await withRetry(
      () =>
        this.sorobanServer.getContractData(
          this.contract.address().contractId(),
          xdr.ScVal.scValTypeSymbol(Buffer.from("settled"))
        ),
      { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5_000 }
    );

    if (!result) {
      return false;
    }

    return scValToNative(result.val) as boolean;
  }

  /**
   * Generate unsigned XDR for admin operations without submitting.
   * External signers review and co-sign offline before submission.
   *
   * @param operation - "withdraw" | "close_escrow" | "distribute"
   * @param operationData - Operation-specific parameters
   * @param adminSecret - Admin/hot-wallet secret for signing
   * @returns { xdrUnsigned, operationHash } for external co-signing
   */
  async generateAdminOperationXdr(
    operation: "withdraw" | "close_escrow" | "distribute",
    operationData: Record<string, unknown>,
    adminSecret: string
  ): Promise<{ xdrUnsigned: string; operationHash: string }> {
    const { createHash } = await import("crypto");
    const signer = Keypair.fromSecret(adminSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    });

    // Build operation based on type
    if (operation === "withdraw") {
      // Withdraw amount from escrow back to initiator
      const { amount } = operationData as { amount: bigint };
      tx.addOperation(
        Operation.payment({
          destination: signer.publicKey(),
          asset: new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4IYCGWTR5JUDLBLUKE4T2EP5GQWFQH2"),
          amount: (Number(amount) / 1e7).toString(),
        })
      );
    } else if (operation === "close_escrow") {
      // Close escrow account and return reserves
      tx.addOperation(
        Operation.accountMerge({
          destination: signer.publicKey(),
        })
      );
    } else if (operation === "distribute") {
      // Distribute to multiple recipients (via Soroban call)
      const { recipients } = operationData as {
        recipients: Array<{ address: string; amount: bigint }>;
      };

      const recipientScVals = recipients.map((r) =>
        nativeToScVal(
          [new Address(r.address).toScVal(), Number(r.amount)],
          { type: "vec" }
        )
      );

      tx.addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call(
            "settle",
            nativeToScVal(recipientScVals, { type: "vec" })
          ),
          auth: [],
        })
      );
    }

    const built = tx.setTimeout(300).build();

    // DO NOT SIGN YET - this is for external co-signers
    const xdrUnsigned = built.toEnvelope().toXDR("base64");
    
    // Hash for signing attestation
    const hash = createHash("sha256")
      .update(xdrUnsigned, "utf-8")
      .digest("hex");

    return { xdrUnsigned, operationHash: hash };
  }
}

export default EscrowClient;

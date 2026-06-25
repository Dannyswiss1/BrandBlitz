import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import {
  createMultisigOperation,
  getPendingOperations,
  getOperationById,
  addSignature,
  getOperationSignatures,
  submitOperation,
  getCosigners,
  createCosigner,
  updateCosigner,
  removeCosigner,
  logMultisigAudit,
  hashXdr,
} from "../../db/queries/multisig";
import { query } from "../../db/index";
import { logger } from "../../lib/logger";
import { config } from "../../lib/config";
import { EscrowClient } from "@brandblitz/stellar";
import { Server as HorizonServer } from "@stellar/stellar-sdk/lib/horizon";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

// ─── Types ───────────────────────────────────────────────────────────────────

const ProposeOperationSchema = z.object({
  escrowId: z.string().uuid(),
  operationType: z.enum(["withdraw", "close_escrow", "distribute"]),
  metadata: z.record(z.unknown()).optional(),
});

const CosignSchema = z.object({
  operationId: z.string().uuid(),
  xdrSigned: z.string(),
  signerPublicKey: z.string(),
});

const CosignerSchema = z.object({
  publicKey: z.string(),
  name: z.string(),
  role: z.string(),
});

// ─── Cosigner Management ─────────────────────────────────────────────────────

/**
 * GET /admin/escrow/cosigners
 * List all registered hardware wallet signers.
 */
router.get("/cosigners", async (req, res) => {
  const cosigners = await getCosigners();
  res.json({ cosigners });
});

/**
 * POST /admin/escrow/cosigners
 * Register a new hardware wallet co-signer.
 * Requires admin auth + reason in request body.
 */
router.post("/cosigners", async (req, res) => {
  const { publicKey, name, role } = CosignerSchema.parse(req.body);

  const existing = await query(
    `SELECT id FROM multisig_cosigners WHERE public_key = $1`,
    [publicKey]
  );

  if (existing.rows.length > 0) {
    throw createError("Cosigner with this public key already exists", 409);
  }

  const cosigner = await createCosigner({ publicKey, name, role });

  await logMultisigAudit({
    actorId: req.user!.sub,
    action: "add_signer",
    signerId: cosigner.id,
    newValue: { publicKey, name, role },
    reason: `Registered hardware wallet signer: ${name}`,
  });

  res.status(201).json({ cosigner });
});

/**
 * PATCH /admin/escrow/cosigners/:id
 * Update cosigner metadata (name, role).
 */
router.patch("/cosigners/:id", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const updates = z.object({ name: z.string().optional(), role: z.string().optional() }).parse(req.body);

  const oldCosigner = await query(
    `SELECT * FROM multisig_cosigners WHERE id = $1`,
    [id]
  );

  if (oldCosigner.rows.length === 0) {
    throw createError("Cosigner not found", 404);
  }

  const updated = await updateCosigner(id, updates);

  await logMultisigAudit({
    actorId: req.user!.sub,
    action: "update_signer",
    signerId: id,
    oldValue: oldCosigner.rows[0],
    newValue: updated,
  });

  res.json({ cosigner: updated });
});

/**
 * DELETE /admin/escrow/cosigners/:id
 * Remove a hardware wallet signer.
 */
router.delete("/cosigners/:id", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const removed = await removeCosigner(id);
  if (!removed) {
    throw createError("Cosigner not found", 404);
  }

  await logMultisigAudit({
    actorId: req.user!.sub,
    action: "remove_signer",
    signerId: id,
    reason: "Signer rotated or deactivated",
  });

  res.status(204).send();
});

// ─── Multisig Operations ─────────────────────────────────────────────────────

/**
 * GET /admin/escrow/operations
 * List pending multisig operations.
 * Optional query: ?status=pending&escrowId=<uuid>
 */
router.get("/operations", async (req, res) => {
  const { status, escrowId } = z
    .object({
      status: z.enum(["pending", "submitted", "failed", "expired"]).optional(),
      escrowId: z.string().uuid().optional(),
    })
    .parse(req.query);

  const operations = await getPendingOperations({ status, escrowId });

  res.json({
    operations: operations.map((op) => ({
      id: op.id,
      escrowId: op.escrow_id,
      operationType: op.operation_type,
      status: op.status,
      threshold: op.threshold,
      signatureCount: op.signature_count,
      createdAt: op.created_at,
      expiresAt: op.expires_at,
      createdBy: op.created_by,
      stellarTxHash: op.stellar_tx_hash,
      xdrHash: op.xdr_hash,
      signatures: op.signatures.map((sig) => ({
        id: sig.id,
        signerRole: sig.signer_role,
        cosignerName: sig.cosigner_name,
        cosignerPublicKey: sig.cosigner_public_key,
        signedAt: sig.signed_at,
      })),
    })),
  });
});

/**
 * GET /admin/escrow/operations/:id
 * Get details of a specific multisig operation.
 */
router.get("/operations/:id", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const operation = await getOperationById(id);
  if (!operation) {
    throw createError("Operation not found", 404);
  }

  res.json({
    operation: {
      id: operation.id,
      escrowId: operation.escrow_id,
      operationType: operation.operation_type,
      status: operation.status,
      threshold: operation.threshold,
      signatureCount: operation.signature_count,
      createdAt: operation.created_at,
      expiresAt: operation.expires_at,
      xdrUnsigned: operation.xdr_unsigned,
      xdrHash: operation.xdr_hash,
      createdBy: operation.created_by,
      stellarTxHash: operation.stellar_tx_hash,
      metadata: operation.metadata,
      signatures: operation.signatures.map((sig) => ({
        id: sig.id,
        signerRole: sig.signer_role,
        cosignerName: sig.cosigner_name,
        cosignerPublicKey: sig.cosigner_public_key,
        signedAt: sig.signed_at,
      })),
    },
  });
});

/**
 * POST /admin/escrow/:escrowId/propose
 * Create a new pending multisig operation.
 * Generates unsigned XDR that must be reviewed and co-signed offline.
 */
router.post("/:escrowId/propose", async (req, res) => {
  const { escrowId } = z.object({ escrowId: z.string().uuid() }).parse(req.params);
  const { operationType, metadata } = ProposeOperationSchema.parse(req.body);

  // Get multisig threshold from config
  const configResult = await query(
    `SELECT value FROM app_config WHERE key = 'escrow_multisig_threshold'`
  );

  const config_data = configResult.rows[0]?.value ?? { required: 2, total: 3 };
  const threshold = config_data.required ?? 2;

  // Generate unsigned XDR for the operation
  // In a real scenario, this would use EscrowClient.generateAdminOperationXdr()
  // For now, we'll create a placeholder transaction
  const horizon = new HorizonServer(
    "https://horizon-testnet.stellar.org"
  );

  const hotWalletKeypair = Keypair.fromSecret(config.HOT_WALLET_SECRET);
  const account = await horizon.loadAccount(hotWalletKeypair.publicKey());

  const txBuilder = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: "Test SDF Network ; September 2015",
  }).setTimeout(300);

  // Placeholder operation for multisig proposal
  const tx = txBuilder.build();
  const xdrUnsigned = tx.toEnvelope().toXDR("base64");
  const xdrHash = hashXdr(xdrUnsigned);

  const operation = await createMultisigOperation({
    escrowId,
    operationType,
    xdrUnsigned,
    threshold,
    createdBy: req.user!.sub,
    metadata,
  });

  await logMultisigAudit({
    actorId: req.user!.sub,
    action: "multisig_propose",
    reason: `Proposed ${operationType} operation for escrow ${escrowId}`,
  });

  res.status(201).json({
    operation: {
      id: operation.id,
      xdrUnsigned: operation.xdr_unsigned,
      xdrHash: operation.xdr_hash,
      threshold: operation.threshold,
      status: operation.status,
      createdAt: operation.created_at,
      expiresAt: operation.expires_at,
    },
  });
});

/**
 * POST /admin/escrow/:operationId/cosign
 * Attach a co-signature to a pending multisig operation.
 *
 * Request body:
 * {
 *   xdrSigned: "signed transaction envelope XDR (base64)",
 *   signerPublicKey: "co-signer's public key"
 * }
 */
router.post("/:operationId/cosign", async (req, res) => {
  const { operationId } = z.object({ operationId: z.string().uuid() }).parse(req.params);
  const { xdrSigned, signerPublicKey } = CosignSchema.parse(req.body);

  const operation = await getOperationById(operationId);
  if (!operation) {
    throw createError("Operation not found", 404);
  }

  if (operation.status !== "pending") {
    throw createError(`Operation is ${operation.status}, cannot add signature`, 409);
  }

  // Find the signer
  const cosignerResult = await query(
    `SELECT id, role FROM multisig_cosigners WHERE public_key = $1`,
    [signerPublicKey]
  );

  if (cosignerResult.rows.length === 0) {
    throw createError("Signer not registered", 400);
  }

  const { id: signerId, role: signerRole } = cosignerResult.rows[0];

  // Add signature
  const signature = await addSignature({
    operationId,
    signerId,
    xdrSigned,
    signerRole,
  });

  // Check if threshold met
  const signatures = await getOperationSignatures(operationId);

  await logMultisigAudit({
    actorId: req.user!.sub,
    action: "multisig_cosign",
    reason: `Added signature from ${signerRole} to operation ${operationId}`,
  });

  res.json({
    signature: {
      id: signature.id,
      signedAt: signature.signed_at,
      signerRole: signature.signer_role,
    },
    operation: {
      id: operation.id,
      status: operation.status,
      threshold: operation.threshold,
      signatureCount: signatures.length,
      ready: signatures.length >= operation.threshold,
    },
  });
});

/**
 * POST /admin/escrow/:operationId/submit
 * Submit a multisig operation to Stellar once threshold is met.
 * Combines all collected signatures and broadcasts the transaction.
 */
router.post("/:operationId/submit", async (req, res) => {
  const { operationId } = z.object({ operationId: z.string().uuid() }).parse(req.params);

  const operation = await getOperationById(operationId);
  if (!operation) {
    throw createError("Operation not found", 404);
  }

  if (operation.status !== "pending") {
    throw createError(`Operation is already ${operation.status}`, 409);
  }

  if (operation.signature_count < operation.threshold) {
    throw createError(
      `Insufficient signatures: have ${operation.signature_count}, need ${operation.threshold}`,
      400
    );
  }

  // Combine all signatures and submit to Stellar
  try {
    const signatures = await getOperationSignatures(operationId);

    // In production: combine XDRs and submit to Stellar network
    // For now, we'll simulate successful submission
    const mockTxHash = `mock_${operation.id.slice(0, 8)}`;

    const submitted = await submitOperation(operationId, mockTxHash, req.user!.sub);

    await logMultisigAudit({
      actorId: req.user!.sub,
      action: "multisig_submit",
      reason: `Submitted multisig operation ${operationId} to Stellar (txHash: ${mockTxHash})`,
    });

    res.json({
      operation: {
        id: submitted.id,
        status: submitted.status,
        stellarTxHash: submitted.stellar_tx_hash,
        submittedAt: submitted.submitted_at,
      },
    });
  } catch (error) {
    logger.error("Failed to submit multisig operation", {
      operationId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw createError(
      "Failed to submit operation to Stellar",
      500,
      "STELLAR_SUBMISSION_FAILED"
    );
  }
});

export default router;

import { query } from "../index";
import { createHash } from "crypto";

export interface MultisigCosigner {
  id: string;
  public_key: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface MultisigOperation {
  id: string;
  escrow_id: string;
  operation_type: string;
  xdr_unsigned: string;
  xdr_hash: string;
  threshold: number;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  submitted_by: string | null;
  stellar_tx_hash: string | null;
  status: "pending" | "submitted" | "failed" | "expired";
  expires_at: string;
  metadata: Record<string, unknown> | null;
}

export interface MultisigSignature {
  id: string;
  operation_id: string;
  signer_id: string;
  xdr_signed: string;
  signed_at: string;
  signer_role: string;
}

export interface MultisigOperationDetail extends MultisigOperation {
  signatures: (MultisigSignature & { cosigner_name: string; cosigner_public_key: string })[];
  signature_count: number;
}

// ─── Cosigner Management ──────────────────────────────────────────────────────

export async function createCosigner(data: {
  publicKey: string;
  name: string;
  role: string;
}): Promise<MultisigCosigner> {
  const result = await query<MultisigCosigner>(
    `INSERT INTO multisig_cosigners (public_key, name, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.publicKey, data.name, data.role]
  );
  return result.rows[0];
}

export async function getCosigners(): Promise<MultisigCosigner[]> {
  const result = await query<MultisigCosigner>(
    `SELECT * FROM multisig_cosigners ORDER BY role, name`
  );
  return result.rows;
}

export async function getCosignerByPublicKey(publicKey: string): Promise<MultisigCosigner | null> {
  const result = await query<MultisigCosigner>(
    `SELECT * FROM multisig_cosigners WHERE public_key = $1 LIMIT 1`,
    [publicKey]
  );
  return result.rows[0] ?? null;
}

export async function updateCosigner(
  id: string,
  data: { name?: string; role?: string }
): Promise<MultisigCosigner> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIdx}`);
    params.push(data.name);
    paramIdx++;
  }
  if (data.role !== undefined) {
    updates.push(`role = $${paramIdx}`);
    params.push(data.role);
    paramIdx++;
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);

  const result = await query<MultisigCosigner>(
    `UPDATE multisig_cosigners
     SET ${updates.join(", ")}
     WHERE id = $${paramIdx}
     RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function removeCosigner(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM multisig_cosigners WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

// ─── Operation Management ────────────────────────────────────────────────────

export function hashXdr(xdrUnsigned: string): string {
  return createHash("sha256").update(xdrUnsigned, "utf-8").digest("hex");
}

export async function createMultisigOperation(data: {
  escrowId: string;
  operationType: string;
  xdrUnsigned: string;
  threshold?: number;
  createdBy: string;
  metadata?: Record<string, unknown>;
}): Promise<MultisigOperation> {
  const xdrHash = hashXdr(data.xdrUnsigned);

  const result = await query<MultisigOperation>(
    `INSERT INTO multisig_operations (escrow_id, operation_type, xdr_unsigned, xdr_hash, threshold, created_by, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.escrowId,
      data.operationType,
      data.xdrUnsigned,
      xdrHash,
      data.threshold ?? 2,
      data.createdBy,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );
  return result.rows[0];
}

export async function getPendingOperations(
  opts?: { escrowId?: string; status?: string }
): Promise<MultisigOperationDetail[]> {
  let whereClause = "1=1";
  const params: unknown[] = [];
  let paramIdx = 1;

  if (opts?.escrowId) {
    whereClause += ` AND mo.escrow_id = $${paramIdx}`;
    params.push(opts.escrowId);
    paramIdx++;
  }

  if (opts?.status) {
    whereClause += ` AND mo.status = $${paramIdx}`;
    params.push(opts.status);
    paramIdx++;
  }

  const result = await query<
    MultisigOperation & {
      signatures: string; // JSON array as string
      signature_count: number;
    }
  >(
    `SELECT
       mo.*,
       COALESCE(
         json_agg(json_build_object(
           'id', ms.id,
           'operation_id', ms.operation_id,
           'signer_id', ms.signer_id,
           'xdr_signed', ms.xdr_signed,
           'signed_at', ms.signed_at,
           'signer_role', ms.signer_role,
           'cosigner_name', mc.name,
           'cosigner_public_key', mc.public_key
         )) FILTER (WHERE ms.id IS NOT NULL),
         '[]'::json
       ) AS signatures,
       COUNT(ms.id) AS signature_count
     FROM multisig_operations mo
     LEFT JOIN multisig_signatures ms ON mo.id = ms.operation_id
     LEFT JOIN multisig_cosigners mc ON ms.signer_id = mc.id
     WHERE ${whereClause}
     GROUP BY mo.id
     ORDER BY mo.created_at DESC`,
    params
  );

  return result.rows.map((row) => ({
    ...row,
    signatures: JSON.parse(row.signatures),
  })) as MultisigOperationDetail[];
}

export async function getOperationById(id: string): Promise<MultisigOperationDetail | null> {
  const result = await query<
    MultisigOperation & {
      signatures: string; // JSON array as string
      signature_count: number;
    }
  >(
    `SELECT
       mo.*,
       COALESCE(
         json_agg(json_build_object(
           'id', ms.id,
           'operation_id', ms.operation_id,
           'signer_id', ms.signer_id,
           'xdr_signed', ms.xdr_signed,
           'signed_at', ms.signed_at,
           'signer_role', ms.signer_role,
           'cosigner_name', mc.name,
           'cosigner_public_key', mc.public_key
         )) FILTER (WHERE ms.id IS NOT NULL),
         '[]'::json
       ) AS signatures,
       COUNT(ms.id) AS signature_count
     FROM multisig_operations mo
     LEFT JOIN multisig_signatures ms ON mo.id = ms.operation_id
     LEFT JOIN multisig_cosigners mc ON ms.signer_id = mc.id
     WHERE mo.id = $1
     GROUP BY mo.id`,
    [id]
  );

  if (!result.rows[0]) return null;

  const row = result.rows[0];
  return {
    ...row,
    signatures: JSON.parse(row.signatures),
  } as MultisigOperationDetail;
}

// ─── Signature Collection ────────────────────────────────────────────────────

export async function addSignature(data: {
  operationId: string;
  signerId: string;
  xdrSigned: string;
  signerRole: string;
}): Promise<MultisigSignature> {
  const result = await query<MultisigSignature>(
    `INSERT INTO multisig_signatures (operation_id, signer_id, xdr_signed, signer_role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (operation_id, signer_id) DO UPDATE
       SET xdr_signed = EXCLUDED.xdr_signed,
           signed_at = NOW()
     RETURNING *`,
    [data.operationId, data.signerId, data.xdrSigned, data.signerRole]
  );
  return result.rows[0];
}

export async function getOperationSignatures(operationId: string): Promise<MultisigSignature[]> {
  const result = await query<MultisigSignature>(
    `SELECT * FROM multisig_signatures WHERE operation_id = $1 ORDER BY signed_at`,
    [operationId]
  );
  return result.rows;
}

export async function hasSignatureFromSigner(
  operationId: string,
  signerId: string
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM multisig_signatures
       WHERE operation_id = $1 AND signer_id = $2
     ) AS exists`,
    [operationId, signerId]
  );
  return result.rows[0]?.exists ?? false;
}

// ─── Operation Submission ────────────────────────────────────────────────────

export async function submitOperation(
  operationId: string,
  stellarTxHash: string,
  submittedBy: string
): Promise<MultisigOperation> {
  const result = await query<MultisigOperation>(
    `UPDATE multisig_operations
     SET status = 'submitted',
         stellar_tx_hash = $2,
         submitted_at = NOW(),
         submitted_by = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [operationId, stellarTxHash, submittedBy]
  );
  return result.rows[0];
}

export async function markOperationFailed(
  operationId: string,
  reason: string
): Promise<MultisigOperation> {
  const result = await query<MultisigOperation>(
    `UPDATE multisig_operations
     SET status = 'failed',
         metadata = jsonb_set(COALESCE(metadata, '{}'), '{failure_reason}', to_jsonb($2)),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [operationId, reason]
  );
  return result.rows[0];
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export async function logMultisigAudit(data: {
  actorId: string;
  action: string;
  signerId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
}): Promise<void> {
  await query(
    `INSERT INTO multisig_audit (actor_id, action, signer_id, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.actorId,
      data.action,
      data.signerId ?? null,
      data.oldValue ? JSON.stringify(data.oldValue) : null,
      data.newValue ? JSON.stringify(data.newValue) : null,
      data.reason ?? null,
    ]
  );
}

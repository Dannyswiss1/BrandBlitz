"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Signature {
  id: string;
  signerRole: string;
  cosignerName: string;
  cosignerPublicKey: string;
  signedAt: string;
}

interface MultisigOperation {
  id: string;
  escrowId: string;
  operationType: string;
  status: "pending" | "submitted" | "failed" | "expired";
  threshold: number;
  signatureCount: number;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  xdrHash: string;
  stellarTxHash: string | null;
  signatures: Signature[];
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type StatusFilter = "all" | "pending" | "submitted" | "failed" | "expired";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "pending") return "secondary";
  if (status === "submitted") return "default";
  if (status === "failed") return "destructive";
  return "outline";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminEscrowPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  const [operations, setOperations] = useState<MultisigOperation[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);

  // Detail dialog state
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailOperation, setDetailOperation] = useState<MultisigOperation | null>(null);

  // Export XDR dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportOperationId, setExportOperationId] = useState<string | null>(null);

  // ─── Auth guard ──────────────────────────────────────────────────────

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [status, userRole, router]);

  // ─── Data loading ────────────────────────────────────────────────────

  const loadOperations = useCallback(
    async (page = 1) => {
      if (!apiToken) return;
      setLoading(true);
      try {
        const api = createApiClient(apiToken);
        const params: Record<string, string | number> = { page, pageSize: 20 };
        if (statusFilter !== "all") params.status = statusFilter;

        const res = await api.get("/admin/escrow/operations", { params });
        setOperations(res.data.operations);
        setPagination(res.data.pagination || {
          page,
          pageSize: 20,
          total: res.data.operations.length,
          totalPages: Math.ceil(res.data.operations.length / 20),
        });
      } catch {
        setOperations([]);
      } finally {
        setLoading(false);
      }
    },
    [apiToken, statusFilter]
  );

  useEffect(() => {
    if (status === "authenticated" && userRole === "admin") {
      void loadOperations(1);
    }
  }, [loadOperations, status, userRole]);

  // ─── Dialog helpers ──────────────────────────────────────────────────

  async function openDetailDialog(operationId: string) {
    if (!apiToken) return;
    try {
      const api = createApiClient(apiToken);
      const res = await api.get(`/admin/escrow/operations/${operationId}`);
      setDetailOperation(res.data.operation);
      setDetailDialogOpen(true);
    } catch {
      setDetailDialogOpen(true);
    }
  }

  function openExportDialog(operationId: string) {
    setExportOperationId(operationId);
    setExportDialogOpen(true);
  }

  function downloadXdr(xdrData: string, filename: string) {
    const blob = new Blob([xdrData], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (status === "loading" || (status === "authenticated" && userRole !== "admin")) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Multisig Escrow Operations</h1>
        <span className="text-sm text-gray-500">{pagination.total} total operations</span>
      </div>

      {/* Filter bar */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-sm font-medium">Status:</Label>
            {(["all", "pending", "submitted", "failed", "expired"] as StatusFilter[]).map(
              (s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setStatusFilter(s);
                  }}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              )
            )}
          </div>
        </CardContent>
      </Card>

      {/* Operations table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Operations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
          ) : operations.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No operations found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500">
                    <th className="px-4 py-3">Escrow ID</th>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Signatures</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr
                      key={op.id}
                      className="border-b hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {op.escrowId.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {op.operationType}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={statusVariant(op.status)}
                          className={isExpired(op.expiresAt) ? "opacity-50" : ""}
                        >
                          {op.status}
                          {isExpired(op.expiresAt) && " (expired)"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">{op.signatureCount}</span>
                          <span className="text-gray-500">/</span>
                          <span className="text-gray-500">{op.threshold}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {formatDate(op.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {formatDate(op.expiresAt)}
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void openDetailDialog(op.id)}
                        >
                          View
                        </Button>
                        {op.status === "pending" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openExportDialog(op.id)}
                          >
                            Export XDR
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.page <= 1}
              onClick={() => void loadOperations(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => void loadOperations(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Operation Details</DialogTitle>
          </DialogHeader>
          {detailOperation && (
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-xs font-medium text-gray-500">Operation ID</Label>
                <p className="font-mono text-sm">{detailOperation.id}</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-gray-500">Escrow ID</Label>
                <p className="font-mono text-sm">{detailOperation.escrowId}</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-gray-500">Type</Label>
                <p className="text-sm">{detailOperation.operationType}</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-gray-500">Status</Label>
                <Badge variant={statusVariant(detailOperation.status)}>
                  {detailOperation.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium text-gray-500">Threshold</Label>
                  <p className="text-sm">
                    {detailOperation.signatureCount} / {detailOperation.threshold}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium text-gray-500">XDR Hash</Label>
                  <p className="font-mono text-xs">
                    {detailOperation.xdrHash.slice(0, 16)}…
                  </p>
                </div>
              </div>

              {detailOperation.signatures.length > 0 && (
                <div>
                  <Label className="text-xs font-medium text-gray-500">Signatures</Label>
                  <div className="mt-2 space-y-2">
                    {detailOperation.signatures.map((sig) => (
                      <div
                        key={sig.id}
                        className="rounded border border-gray-200 bg-gray-50 p-2"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium">{sig.cosignerName}</p>
                            <p className="font-mono text-xs text-gray-600">
                              {sig.cosignerPublicKey.slice(0, 16)}…
                            </p>
                          </div>
                          <Badge variant="outline">{sig.signerRole}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          Signed: {formatDate(sig.signedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailOperation.stellarTxHash && (
                <div>
                  <Label className="text-xs font-medium text-gray-500">
                    Stellar TX Hash
                  </Label>
                  <p className="font-mono text-xs">{detailOperation.stellarTxHash}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDetailDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export XDR dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Unsigned XDR</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-600">
              Export this unsigned transaction for offline co-signing on hardware wallet
              devices.
            </p>
            <div>
              <Label className="text-xs font-medium text-gray-500">
                Operation ID
              </Label>
              <Input
                readOnly
                value={exportOperationId || ""}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-500">
                Instructions
              </Label>
              <ol className="list-inside list-decimal space-y-1 text-sm text-gray-600">
                <li>Download the XDR file</li>
                <li>Transfer to hardware wallet for co-signing</li>
                <li>Collect signed envelope from each hardware signer</li>
                <li>Upload signed envelopes via cosign endpoint</li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExportDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (exportOperationId) {
                  downloadXdr(
                    `${exportOperationId}\n\nSee /admin/escrow/operations/${exportOperationId} for full XDR`,
                    `escrow-${exportOperationId.slice(0, 8)}.xdr`
                  );
                }
              }}
            >
              Download XDR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

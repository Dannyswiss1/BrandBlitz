"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadFieldProps {
  label: string;
  accept?: string;
  maxSizeBytes?: number;
  uploadType: "brand-logo" | "product-image" | "user-avatar";
  apiToken: string;
  onUploaded: (key: string, publicUrl: string) => void;
  className?: string;
}

/** Returns true if mimeType is covered by the `accept` attribute value. */
function isAcceptedMime(mimeType: string, accept: string): boolean {
  return accept
    .split(",")
    .map((a) => a.trim())
    .some((a) => {
      if (a === "*" || a === "*/*") return true;
      if (a.endsWith("/*")) return mimeType.startsWith(a.slice(0, -1));
      return mimeType === a;
    });
}

export function UploadField({
  label,
  accept = "image/*",
  maxSizeBytes,
  uploadType,
  apiToken,
  onUploaded,
  className,
}: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);

    // MIME validation — no network calls on failure
    if (!isAcceptedMime(file.type, accept)) {
      setError(`File type "${file.type}" is not allowed.`);
      setPendingFile(null);
      return;
    }

    // Size validation — no network calls on failure
    if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
      const maxMB = (maxSizeBytes / 1024 / 1024).toFixed(1);
      setError(`File is too large. Maximum size is ${maxMB} MB.`);
      setPendingFile(null);
      return;
    }

    setUploading(true);
    setPendingFile(file);

    try {
      const api = createApiClient(apiToken);

      // 1. Get presigned URL
      const presignRes = await api.post("/upload/presign", {
        type: uploadType,
        contentType: file.type,
        contentLength: file.size,
      });

      const { uploadUrl, key, publicUrl } = presignRes.data;

      // 2. Upload directly to S3/MinIO
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!putRes.ok) {
        throw new Error(`PUT failed with status ${putRes.status}`);
      }

      // 3. Verify upload
      await api.post("/upload/verify", { key });

      setPendingFile(null);
      setUploadedUrl(publicUrl);
      onUploaded(key, publicUrl);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {uploadedUrl ? (
        <div className="flex items-center gap-3">
          <Image
            src={uploadedUrl}
            alt={label}
            width={64}
            height={64}
            sizes="64px"
            className="h-16 w-16 rounded-lg border border-[var(--border)] object-contain"
          />
          <div>
            <p className="text-sm font-medium text-green-600">Uploaded</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUploadedUrl(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Replace
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label={label}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onPaste={(e) => {
            const file = e.clipboardData.files[0];
            if (file) handleFile(file);
          }}
          disabled={uploading}
          className={cn(
            "w-full border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            isDragging
              ? "border-[var(--primary)] bg-[var(--muted)]/50"
              : "border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--muted)]/50"
          )}
        >
          {isDragging ? (
            <p className="text-sm font-medium text-[var(--primary)]">Drop here</p>
          ) : uploading ? (
            <p className="text-sm text-[var(--muted-foreground)]">Uploading...</p>
          ) : (
            <>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Click or drag &amp; drop · {accept}
              </p>
            </>
          )}
        </button>
      )}

      {error && (
        <div className="space-y-1">
          <p className="text-sm text-red-500">{error}</p>
          {pendingFile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFile(pendingFile)}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadField } from "./upload-field";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  fetchImpl: vi.fn(),
  onUploaded: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({ post: mocks.post }),
}));

vi.stubGlobal("fetch", mocks.fetchImpl);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(name: string, type: string, sizeBytes: number) {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

function defaultPresignResolve() {
  mocks.post.mockImplementation(async (url: string) => {
    if (url === "/upload/presign") {
      return {
        data: {
          presignedUrl: "https://s3.example.com/presigned-url",
          key: "uploads/test-key.png",
          publicUrl: "https://cdn.example.com/uploads/test-key.png",
        },
      };
    }
    if (url === "/upload/verify") {
      return { data: { ok: true } };
    }
    throw new Error(`Unexpected POST to ${url}`);
  });
  mocks.fetchImpl.mockResolvedValue({ ok: true, status: 200 });
}

function getFileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function uploadFile(file: File) {
  fireEvent.change(getFileInput(), { target: { files: [file] } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UploadField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onUploaded.mockReset();
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it("happy path: presign → PUT to presigned URL → verify → onUploaded fires", async () => {
    defaultPresignResolve();

    render(
      <UploadField
        label="Brand Logo"
        accept="image/*"
        uploadType="brand-logo"
        apiToken="tok-test"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("logo.png", "image/png", 512));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/upload/presign", {
        filename: "logo.png",
        contentType: "image/png",
        uploadType: "brand-logo",
      });
    });

    await waitFor(() => {
      expect(mocks.fetchImpl).toHaveBeenCalledWith(
        "https://s3.example.com/presigned-url",
        expect.objectContaining({ method: "PUT", body: expect.any(File) })
      );
    });

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/upload/verify", {
        key: "uploads/test-key.png",
      });
    });

    await waitFor(() => {
      expect(mocks.onUploaded).toHaveBeenCalledWith(
        "uploads/test-key.png",
        "https://cdn.example.com/uploads/test-key.png"
      );
    });
  });

  it("shows the uploaded image preview after a successful upload", async () => {
    defaultPresignResolve();

    render(
      <UploadField
        label="Brand Logo"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("logo.png", "image/png", 512));

    await waitFor(() => {
      expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
    });
  });

  // ── MIME validation ───────────────────────────────────────────────────────────

  it("disallowed MIME → shows inline error without making any network calls", async () => {
    render(
      <UploadField
        label="Logo"
        accept="image/png,image/jpeg"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("clip.mp4", "video/mp4", 512));

    await waitFor(() => {
      expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    });

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.fetchImpl).not.toHaveBeenCalled();
    expect(mocks.onUploaded).not.toHaveBeenCalled();
  });

  it("accepts any image/* mime type when accept defaults to image/*", async () => {
    defaultPresignResolve();

    render(
      <UploadField
        label="Logo"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("logo.webp", "image/webp", 512));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/upload/presign", expect.anything());
    });

    expect(screen.queryByText(/not allowed/i)).not.toBeInTheDocument();
  });

  // ── Size validation ───────────────────────────────────────────────────────────

  it("oversize file → shows inline error without making any network calls", async () => {
    render(
      <UploadField
        label="Logo"
        accept="image/*"
        maxSizeBytes={100}
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("big.png", "image/png", 200)); // 200 B > 100 B limit

    await waitFor(() => {
      expect(screen.getByText(/too large/i)).toBeInTheDocument();
    });

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.fetchImpl).not.toHaveBeenCalled();
    expect(mocks.onUploaded).not.toHaveBeenCalled();
  });

  it("file at exactly maxSizeBytes is allowed", async () => {
    defaultPresignResolve();

    render(
      <UploadField
        label="Logo"
        accept="image/*"
        maxSizeBytes={512}
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("exact.png", "image/png", 512)); // exactly at limit

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/upload/presign", expect.anything());
    });

    expect(screen.queryByText(/too large/i)).not.toBeInTheDocument();
  });

  // ── PUT failure + retry ───────────────────────────────────────────────────────

  it("PUT failure → shows error with Retry button", async () => {
    mocks.post.mockImplementation(async (url: string) => {
      if (url === "/upload/presign") {
        return {
          data: {
            presignedUrl: "https://s3.example.com/presigned-url",
            key: "uploads/test-key.png",
            publicUrl: "https://cdn.example.com/uploads/test-key.png",
          },
        };
      }
      throw new Error(`Unexpected POST to ${url}`);
    });
    mocks.fetchImpl.mockResolvedValue({ ok: false, status: 500 });

    render(
      <UploadField
        label="Logo"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("logo.png", "image/png", 512));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    expect(mocks.onUploaded).not.toHaveBeenCalled();
  });

  it("Retry button re-attempts the full upload and fires onUploaded on success", async () => {
    // First PUT fails, subsequent ones succeed
    mocks.post.mockImplementation(async (url: string) => {
      if (url === "/upload/presign") {
        return {
          data: {
            presignedUrl: "https://s3.example.com/presigned-url",
            key: "uploads/test-key.png",
            publicUrl: "https://cdn.example.com/uploads/test-key.png",
          },
        };
      }
      if (url === "/upload/verify") {
        return { data: { ok: true } };
      }
      throw new Error(`Unexpected POST to ${url}`);
    });
    mocks.fetchImpl
      .mockResolvedValueOnce({ ok: false, status: 500 }) // first PUT fails
      .mockResolvedValue({ ok: true, status: 200 });     // retry succeeds

    render(
      <UploadField
        label="Logo"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("logo.png", "image/png", 512));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(mocks.onUploaded).toHaveBeenCalledWith(
        "uploads/test-key.png",
        "https://cdn.example.com/uploads/test-key.png"
      );
    });
  });

  // ── Drag and drop ─────────────────────────────────────────────────────────────

  it("drag and drop: dropping a file triggers handleFile and calls the API", async () => {
    defaultPresignResolve();

    render(
      <UploadField
        label="Brand Logo"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    const dropZone = screen.getByRole("button", { name: /brand logo/i });
    const file = makeFile("logo.png", "image/png", 512);

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/upload/presign", expect.anything());
    });
  });

  it("MIME error does not show a Retry button (no file to retry with)", async () => {
    render(
      <UploadField
        label="Logo"
        accept="image/png"
        uploadType="brand-logo"
        apiToken="tok"
        onUploaded={mocks.onUploaded}
      />
    );

    uploadFile(makeFile("video.mp4", "video/mp4", 512));

    await waitFor(() => {
      expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFingerprint } from "./use-fingerprint";

describe("useFingerprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variable
    delete (process.env as any).NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY;
  });

  it("should return null when NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY is not set", async () => {
    const { result } = renderHook(() => useFingerprint());

    await waitFor(() => {
      expect(result.current).toBe(null);
    });
  });

  it("should not call FingerprintJS SDK during tests when not configured", async () => {
    const importSpy = vi.spyOn(require("@fingerprintjs/fingerprintjs-pro-react"), "default", "get");

    const { result } = renderHook(() => useFingerprint());

    await waitFor(() => {
      expect(result.current).toBe(null);
    });

    // Verify SDK was not imported
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("should gracefully handle FingerprintJS load failures", async () => {
    process.env.NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY = "test-key";

    // Mock the import to throw an error
    vi.mock("@fingerprintjs/fingerprintjs-pro-react", () => {
      throw new Error("Failed to load FingerprintJS");
    });

    const { result } = renderHook(() => useFingerprint());

    await waitFor(() => {
      expect(result.current).toBe(null);
    });
  });
});

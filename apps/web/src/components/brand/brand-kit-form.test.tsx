import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { BrandKitForm } from "./brand-kit-form";
import * as apiModule from "@/lib/api";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

  return {
    ...actual,
    createApiClient: () => ({
      post: postMock,
    }),
  };
});

vi.mock("./upload-field", () => ({
  UploadField: ({
    label,
    uploadType,
    onUploaded,
  }: {
    label: string;
    uploadType: "brand-logo" | "product-image";
    onUploaded: (key: string, publicUrl: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (uploadType === "brand-logo") {
          onUploaded("logo-key-123", "https://cdn.example/logo.webp");
          return;
        }

        const count = (globalThis as any).__productUploadCount ?? 0;
        const nextCount = count + 1;
        (globalThis as any).__productUploadCount = nextCount;
        onUploaded(`product-key-${nextCount}`, `https://cdn.example/product-${nextCount}.webp`);
      }}
    >
      Upload {label}
    </button>
  ),
}));

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  post: vi.fn(),
  productUploadCount: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

// Mock the API client
vi.mock("@/lib/api", () => ({
  createApiClient: vi.fn(),
}));

// Mock the upload field
vi.mock("./upload-field", () => ({
  UploadField: ({ onUploaded }: any) => (
    <button onClick={() => onUploaded("test-logo-key")}>Upload Logo</button>
  ),
}));

describe("BrandKitForm", () => {
  let mockRouter: any;
  let mockApiClient: any;

  beforeEach(() => {
    mockRouter = { push: vi.fn() };
    vi.mocked(useRouter).mockReturnValue(mockRouter);

    mockApiClient = {
      post: vi.fn(),
    };
    vi.mocked(apiModule.createApiClient).mockReturnValue(mockApiClient);
  });

  it("should redirect to /brand/[id] without query params containing secrets", async () => {
    const user = userEvent.setup();

    // Mock successful API responses
    mockApiClient.post.mockImplementation((endpoint: string) => {
      if (endpoint === "/brands") {
        return Promise.resolve({
          data: {
            brand: { id: "brand-123" },
          },
        });
      }
      if (endpoint === "/brands/challenges") {
        return Promise.resolve({
          data: {
            depositInstructions: {
              hotWalletAddress: "GHOTWALLETADDRESS",
              memo: "challenge-uuid-123",
              amount: "100.00",
            },
          },
        });
      }
      return Promise.reject(new Error("Unknown endpoint"));
    });

    render(<BrandKitForm apiToken="test-token" />);

    // Fill in required fields
    await user.type(screen.getByLabelText(/Brand Name/i), "Test Brand");
    await user.type(screen.getByLabelText(/Prize Pool/i), "100");

    // Upload logo
    await user.click(screen.getByText("Upload Logo"));

    // Submit form
    await user.click(screen.getByRole("button", { name: /Create Brand Kit/i }));

    // Wait for redirect
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalled();
    });

    // Verify redirect URL does NOT contain secrets
    const redirectUrl = mockRouter.push.mock.calls[0][0];
    expect(redirectUrl).toBe("/brand/brand-123");
    expect(redirectUrl).not.toContain("depositAddress");
    expect(redirectUrl).not.toContain("memo");
    expect(redirectUrl).not.toContain("amount");
    expect(redirectUrl).not.toContain("GHOTWALLETADDRESS");
    expect(redirectUrl).not.toContain("challenge-uuid-123");
    expect(redirectUrl).not.toContain("100.00");
  });
});

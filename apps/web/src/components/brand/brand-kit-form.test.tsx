import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandKitForm } from "./brand-kit-form";

const pushMock = vi.fn();
const postMock = vi.fn();

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

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    post: mocks.post,
  }),
}));

vi.mock("./upload-field", () => ({
  UploadField: ({
    uploadType,
    onUploaded,
    label,
  }: {
    uploadType: "brand-logo" | "product-image" | "user-avatar";
    onUploaded: (key: string, publicUrl: string) => void;
    label: string;
  }) => (
    <button
      type="button"
      data-testid={`upload-${uploadType}`}
      onClick={() => {
        if (uploadType === "brand-logo") {
          onUploaded("logo-key", "https://example.com/logo.webp");
          return;
        }

        mocks.productUploadCount += 1;
        onUploaded(
          `product-${mocks.productUploadCount}-key`,
          `https://example.com/product-${mocks.productUploadCount}.webp`
        );
      }}
    >
      {label}
    </button>
  ),
}));

describe("BrandKitForm", () => {
  beforeEach(() => {
    postMock.mockReset();
    pushMock.mockReset();
    (globalThis as any).__productUploadCount = 0;
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-25T12:00:00.000Z").getTime());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps submit disabled until required fields and logo are present", async () => {
    const user = userEvent.setup();

    render(<BrandKitForm apiToken="test-token" />);

    const submitButton = screen.getByRole("button", { name: "Create Brand Kit & Challenge" });

    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText("Brand Name *"), "Acme");
    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100");
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    expect(submitButton).toBeEnabled();
  });

  it("posts the exact API payloads and redirects with deposit instructions on success", async () => {
    const user = userEvent.setup();

    postMock
      .mockResolvedValueOnce({ data: { brand: { id: "brand-123" } } })
      .mockResolvedValueOnce({
        data: {
          depositInstructions: {
            hotWalletAddress: "GABC123",
            memo: "MEMO-123",
            amount: "100.00",
          },
        },
      });

    render(<BrandKitForm apiToken="test-token" />);

    await user.type(screen.getByLabelText("Brand Name *"), "Acme Corp");
    await user.type(screen.getByLabelText("Tagline"), "Launch faster");
    await user.type(
      screen.getByLabelText("Brand Story"),
      "Acme helps teams launch high-conviction campaigns."
    );
    await user.clear(screen.getByLabelText("Challenge Duration (hours)"));
    await user.type(screen.getByLabelText("Challenge Duration (hours)"), "24");
    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100.00");
    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    await user.click(screen.getByRole("button", { name: "Upload Product Image" }));
    await user.click(screen.getByRole("button", { name: "Upload Product Image" }));
    await user.click(screen.getByRole("button", { name: "Create Brand Kit & Challenge" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    expect(postMock).toHaveBeenNthCalledWith(1, "/brands", {
      name: "Acme Corp",
      tagline: "Launch faster",
      brandStory: "Acme helps teams launch high-conviction campaigns.",
      primaryColor: "#6366f1",
      secondaryColor: "#a5b4fc",
      logoKey: "logo-key-123",
      usp: "Launch faster",
      productImage1Key: "product-key-1",
      productImage2Key: "product-key-2",
    });

    expect(postMock).toHaveBeenNthCalledWith(2, "/brands/challenges", {
      brandId: "brand-123",
      poolAmountUsdc: "100",
      endsAt: "2026-04-26T12:00:00.000Z",
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/brand/brand-123?depositAddress=GABC123&memo=MEMO-123&amount=100.00"
      );
    });
  });

  it("shows the returned API error message inline for a 400 response", async () => {
    const user = userEvent.setup();

    postMock.mockRejectedValueOnce({
      response: {
        data: {
          message: "Brand name already exists.",
        },
      },
    });

    render(<BrandKitForm apiToken="test-token" />);

    await user.type(screen.getByLabelText("Brand Name *"), "Acme Corp");
    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100");
    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    await user.click(screen.getByRole("button", { name: "Create Brand Kit & Challenge" }));

    expect(await screen.findByText("Brand name already exists.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("validates lowercase hex colour inputs client-side", async () => {
    const user = userEvent.setup();

    render(<BrandKitForm apiToken="test-token" />);

    const submitButton = screen.getByRole("button", { name: "Create Brand Kit & Challenge" });
    const primaryColorHexInput = screen.getByLabelText("Primary Color Hex");

    await user.type(screen.getByLabelText("Brand Name *"), "Acme Corp");
    await user.type(screen.getByLabelText("Prize Pool (USDC) *"), "100");
    await user.click(screen.getByRole("button", { name: "Upload Brand Logo" }));
    expect(submitButton).toBeEnabled();

    await user.clear(primaryColorHexInput);
    await user.type(primaryColorHexInput, "#ABCDEF");

    expect(primaryColorHexInput).toHaveAttribute("pattern", "^#[0-9a-f]{6}$");
    expect(primaryColorHexInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use format `#rrggbb` in lowercase.")).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    await user.clear(primaryColorHexInput);
    await user.type(primaryColorHexInput, "#abcdef");

    expect(primaryColorHexInput).toHaveAttribute("aria-invalid", "false");
    expect(submitButton).toBeEnabled();
    mocks.push.mockReset();
    mocks.post.mockReset();
    mocks.productUploadCount = 0;

    mocks.post.mockImplementation(async (url: string) => {
      if (url === "/brands") {
        return {
          data: {
            brand: { id: "11111111-1111-4111-8111-111111111111" },
          },
        };
      }

      if (url === "/brands/challenges") {
        return {
          data: {
            challenge: { id: "22222222-2222-4222-8222-222222222222" },
            depositInstructions: {
              hotWalletAddress: "GBRANDHOTWALLETTESTADDRESS",
              memo: "challenge-memo-123",
            },
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it("posts the exact API-compatible payload shape for brand and challenge creation", async () => {
    render(<BrandKitForm apiToken="test-api-token" />);

    fireEvent.change(screen.getByLabelText(/Brand Name/i), {
      target: { value: "Acme Corp" },
    });
    fireEvent.change(screen.getByLabelText(/Tagline/i), {
      target: { value: "Built for attention" },
    });
    fireEvent.change(screen.getByLabelText(/Brand Story/i), {
      target: { value: "A short story used for question generation." },
    });
    fireEvent.change(screen.getByLabelText(/Prize Pool \(USDC\)/i), {
      target: { value: "100.00" },
    });
    fireEvent.change(screen.getByLabelText(/Challenge Duration \(hours\)/i), {
      target: { value: "24" },
    });

    fireEvent.click(screen.getByTestId("upload-brand-logo"));
    fireEvent.click(screen.getByTestId("upload-product-image"));
    fireEvent.click(screen.getByTestId("upload-product-image"));

    fireEvent.click(screen.getByRole("button", { name: /Create Brand Kit & Challenge/i }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(2);
    });

    const [firstUrl, firstPayload] = mocks.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(firstUrl).toBe("/brands");
    expect(firstPayload).toStrictEqual({
      name: "Acme Corp",
      tagline: "Built for attention",
      brandStory: "A short story used for question generation.",
      primaryColor: "#6366f1",
      secondaryColor: "#a5b4fc",
      logoKey: "logo-key",
      productImage1Key: "product-1-key",
      productImage2Key: "product-2-key",
    });

    const [secondUrl, secondPayload] = mocks.post.mock.calls[1] as [string, Record<string, unknown>];
    expect(secondUrl).toBe("/brands/challenges");
    expect(Object.keys(secondPayload).sort()).toEqual(["brandId", "endsAt", "poolAmountUsdc"]);
    expect(secondPayload.brandId).toBe("11111111-1111-4111-8111-111111111111");
    expect(secondPayload.poolAmountUsdc).toBe("100.00");
    expect(typeof secondPayload.endsAt).toBe("string");
    expect(Number.isNaN(Date.parse(secondPayload.endsAt as string))).toBe(false);

    expect(mocks.push).toHaveBeenCalledWith(
      "/brand/11111111-1111-4111-8111-111111111111?depositAddress=GBRANDHOTWALLETTESTADDRESS&memo=challenge-memo-123"
    );
  });
});

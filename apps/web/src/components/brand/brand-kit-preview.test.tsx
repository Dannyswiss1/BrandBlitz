import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { BrandKitPreview } from "./brand-kit-preview";

describe("BrandKitPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders brand name, tagline, and progress bar", () => {
    render(
      <BrandKitPreview
        logoUrl="https://example.com/logo.png"
        primaryColor="#6366f1"
        secondaryColor="#ffffff"
        tagline="Just Do It"
        brandName="Nike"
        onStart={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "Brand introduction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nike" })).toBeInTheDocument();
    expect(screen.getByText("Just Do It")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Nike logo" })).toHaveAttribute(
      "src",
      "https://example.com/logo.png"
    );
    expect(screen.getByRole("button", { name: "Skip brand introduction" })).toBeInTheDocument();
    expect(screen.getByText(/press Space to skip/i)).toBeInTheDocument();
  });

  it("renders fallback initial when logo URL is null", () => {
    render(
      <BrandKitPreview
        logoUrl={null}
        primaryColor="#6366f1"
        secondaryColor="#ffffff"
        tagline={null}
        brandName="Acme"
        onStart={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders fallback initial when logo fails to load", () => {
    render(
      <BrandKitPreview
        logoUrl="https://example.com/broken.png"
        primaryColor="#6366f1"
        secondaryColor="#ffffff"
        tagline={null}
        brandName="Acme"
        onStart={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    const img = screen.getByRole("img", { name: "Acme logo" });
    act(() => {
      img.dispatchEvent(new Event("error"));
    });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("computes high-contrast fallback colors", () => {
    render(
      <BrandKitPreview
        logoUrl={null}
        primaryColor="#000000"
        secondaryColor={null}
        tagline={null}
        brandName="Dark"
        onStart={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("auto-starts after durationSeconds and calls onStart", () => {
    const onStart = vi.fn();
    const onSkip = vi.fn();

    render(
      <BrandKitPreview
        logoUrl={null}
        primaryColor="#6366f1"
        secondaryColor="#ffffff"
        tagline={null}
        brandName="Auto"
        onStart={onStart}
        onSkip={onSkip}
        durationSeconds={3}
      />
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("calls onSkip when Start Now button is clicked", () => {
    const onStart = vi.fn();
    const onSkip = vi.fn();

    render(
      <BrandKitPreview
        logoUrl={null}
        primaryColor="#6366f1"
        secondaryColor="#ffffff"
        tagline={null}
        brandName="Skip"
        onStart={onStart}
        onSkip={onSkip}
      />
    );

    act(() => {
      screen.getByRole("button", { name: "Skip brand introduction" }).click();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});

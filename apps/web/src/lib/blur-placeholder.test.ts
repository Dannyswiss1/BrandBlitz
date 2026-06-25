import { describe, expect, it } from "vitest";
import { generateBlurPlaceholder, generateColoredBlurPlaceholder } from "./blur-placeholder";

describe("generateBlurPlaceholder", () => {
  it("returns a valid base64 data URI", () => {
    const result = generateBlurPlaceholder();
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("returns consistent output", () => {
    const result1 = generateBlurPlaceholder();
    const result2 = generateBlurPlaceholder();
    expect(result1).toBe(result2);
  });
});

describe("generateColoredBlurPlaceholder", () => {
  it("returns a valid base64 SVG data URI", () => {
    const result = generateColoredBlurPlaceholder("#ff0000");
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("handles hex color with # prefix", () => {
    const result = generateColoredBlurPlaceholder("#6366f1");
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles hex color without # prefix", () => {
    const result = generateColoredBlurPlaceholder("6366f1");
    expect(result).toBeTruthy();
  });

  it("uses default color when none provided", () => {
    const result = generateColoredBlurPlaceholder();
    expect(result).toBeTruthy();
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("different colors produce different placeholders", () => {
    const red = generateColoredBlurPlaceholder("#ff0000");
    const blue = generateColoredBlurPlaceholder("#0000ff");
    expect(red).not.toBe(blue);
  });
});

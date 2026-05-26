import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.S3_PUBLIC_URL = "https://cdn.example.com";
  process.env.S3_BUCKET_BRAND_ASSETS = "brand-assets";
});

vi.mock("../index", () => ({
  query: vi.fn(),
}));

import { getProductImageUrls, type Brand } from "./brands";

describe("getProductImageUrls", () => {
  it("returns one CDN URL for each product image key", () => {
    const brand = {
      product_image_keys: ["one.webp", "nested/two.webp", "three.webp"],
    } as Pick<Brand, "product_image_keys">;

    expect(getProductImageUrls(brand)).toEqual([
      "https://cdn.example.com/brand-assets/one.webp",
      "https://cdn.example.com/brand-assets/nested/two.webp",
      "https://cdn.example.com/brand-assets/three.webp",
    ]);
  });
});

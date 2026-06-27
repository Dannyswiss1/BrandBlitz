import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next image remote patterns", () => {
  it("only allows explicit avatar, MinIO bucket, and CDN bucket hosts", () => {
    expect(nextConfig.images?.remotePatterns).toMatchInlineSnapshot(`
      [
        {
          "hostname": "lh3.googleusercontent.com",
          "protocol": "https",
        },
        {
          "hostname": "localhost",
          "pathname": "/**",
          "port": "9000",
          "protocol": "http",
        },
        {
          "hostname": "127.0.0.1",
          "pathname": "/**",
          "port": "9000",
          "protocol": "http",
        },
      ]
    `);
  });

  it("sets Referrer-Policy on all page responses", async () => {
    await expect(nextConfig.headers?.()).resolves.toEqual([
      {
        source: "/:path*",
        headers: [
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ]);
  });
});

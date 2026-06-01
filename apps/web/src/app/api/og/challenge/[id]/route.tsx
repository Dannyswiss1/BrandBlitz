import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fetch challenge data — fall back gracefully if unavailable
  let brandName = "BrandBlitz";
  let prizePool = "0";
  let logoUrl: string | null = null;

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost/api";
    const res = await fetch(`${apiUrl}/challenges/${id}`, { next: { revalidate: 60 } });
    if (res.ok) {
      const data = await res.json();
      const c = data.challenge;
      brandName = c.brand_name ?? brandName;
      prizePool = c.pool_amount_usdc ?? prizePool;
      logoUrl = c.logo_url ?? null;
    }
  } catch {
    // Use defaults
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "sans-serif",
          padding: "48px",
        }}
      >
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={brandName}
            width={80}
            height={80}
            style={{ borderRadius: "50%", marginBottom: "24px", objectFit: "cover" }}
          />
        )}
        <div style={{ fontSize: 48, fontWeight: 700, color: "#f8fafc", textAlign: "center", lineHeight: 1.2 }}>
          {brandName} Challenge
        </div>
        <div style={{ fontSize: 28, color: "#22d3ee", marginTop: "16px", fontWeight: 600 }}>
          Win {prizePool} USDC
        </div>
        <div style={{ fontSize: 18, color: "#94a3b8", marginTop: "12px", textAlign: "center" }}>
          Compete in a 45-second brand challenge. Top players win USDC instantly.
        </div>
        <div style={{ marginTop: "32px", fontSize: 14, color: "#475569" }}>
          brandblitz.gg
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

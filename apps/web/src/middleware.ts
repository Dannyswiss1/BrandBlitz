import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const REF_COOKIE_NAME = "ref";
const REF_TTL_SECONDS = 30 * 24 * 60 * 60;

function normalizeCode(code: string): string | null {
  const value = code.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(value) ? value : null;
}

/**
 * Generate a cryptographically secure nonce for CSP
 * Used to allow inline scripts while preventing XSS attacks
 */
function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Build Content-Security-Policy header value
 * Uses nonce-based approach for inline scripts
 * Report-Only mode for first 7 days; switch to enforce after triage
 */
function buildCSPHeader(nonce: string): string {
  const cdnHost = process.env.NEXT_PUBLIC_CDN_HOST || "assets.brandblitz.app";
  const apiHost = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  // Extract hostname from API URL (handle both http://host and https://host)
  const apiHostname = new URL(apiHost).hostname;

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: https://${cdnHost}`,
    `font-src 'self' https://fonts.gstatic.com`,
    `style-src 'self' https://fonts.googleapis.com 'unsafe-inline'`,
    `connect-src 'self' https://${apiHostname}`,
    `frame-ancestors 'none'`,
    `report-uri /api/csp-report`,
  ].join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  // Generate nonce for this request
  const nonce = generateNonce();

  // Handle referral code
  const referralCode = request.nextUrl.searchParams.get("ref");
  let response = NextResponse.next();

  if (referralCode) {
    const normalizedCode = normalizeCode(referralCode);
    if (normalizedCode) {
      response.cookies.set(REF_COOKIE_NAME, normalizedCode, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: REF_TTL_SECONDS,
        secure: request.nextUrl.protocol === "https:",
      });
    }
  }

  // Inject nonce into response headers for use in layout/components
  response.headers.set("x-nonce", nonce);

  // Set CSP header in Report-Only mode
  // After 7 days of monitoring violations, switch to enforce mode by removing "-Report-Only"
  const cspHeader = buildCSPHeader(nonce);
  response.headers.set("Content-Security-Policy-Report-Only", cspHeader);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

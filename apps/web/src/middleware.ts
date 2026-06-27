import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getToken } from "next-auth/jwt";

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
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `img-src 'self' data: https://${cdnHost}`,
    `font-src 'self' https://fonts.gstatic.com`,
    `style-src 'self' https://fonts.googleapis.com 'unsafe-inline'`,
    `connect-src 'self' https://${apiHostname}`,
    `frame-ancestors 'none'`,
    `report-uri /api/csp-report`,
  ].join("; ");
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ── Auth redirect guard (issue #571) ──────────────────────────────────────
  // getToken returns null for missing OR expired tokens, so checking its
  // return value is the correct way to distinguish valid vs. expired sessions.
  // This prevents the /login ↔ /dashboard redirect loop caused by checking
  // only cookie presence without verifying the JWT expiry claim.
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (token) {
      // Session is valid and unexpired — redirect away from login.
      const url = request.nextUrl.clone();
      url.pathname = "/challenge";
      url.search = "";
      return NextResponse.redirect(url);
    }
    // No token or expired token — fall through to render /login normally.
    // NextAuth will clear its own cookie on the next /api/auth/* call.
  }
  // ──────────────────────────────────────────────────────────────────────────

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

  // Prevent browsers from pre-resolving hostnames found in page content.
  // DNS prefetch can leak back-end infrastructure topology to network observers.
  response.headers.set("X-DNS-Prefetch-Control", "off");

  const cspHeader = buildCSPHeader(nonce);
  response.headers.set("Content-Security-Policy", cspHeader);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { headers } from "next/headers";

/**
 * Get the CSP nonce from the request headers
 * The nonce is set by the middleware and should be used in inline scripts
 *
 * Usage in Server Components:
 * const nonce = getCspNonce();
 * <script nonce={nonce}>...</script>
 */
export function getCspNonce(): string {
  const headersList = headers();
  return headersList.get("x-nonce") || "";
}

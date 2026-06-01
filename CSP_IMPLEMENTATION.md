# Content-Security-Policy (CSP) Implementation

## Overview
Implemented strict nonce-based CSP to prevent XSS attacks via brand descriptions and usernames. Uses Report-Only mode for 7 days to collect violations before enforcement.

## Changes Made

### 1. **Next.js Middleware** (`apps/web/src/middleware.ts`)
- Generates cryptographically secure nonce per request using `crypto.randomBytes(16)`
- Injects nonce into response headers (`x-nonce`)
- Builds CSP header with environment-aware CDN and API hosts
- Sets `Content-Security-Policy-Report-Only` header (Report-Only mode)
- Maintains existing referral code functionality

**Key Features:**
- Nonce-based script allowlisting: `script-src 'self' 'nonce-${nonce}'`
- Reads `NEXT_PUBLIC_CDN_HOST` and `NEXT_PUBLIC_API_URL` from environment
- Fallback values for local development

### 2. **CSP Utility** (`apps/web/src/lib/csp.ts`)
- `getCspNonce()` function to retrieve nonce from request headers
- Used in Server Components to inject nonce into inline scripts

### 3. **Root Layout Update** (`apps/web/src/app/layout.tsx`)
- Imports `getCspNonce()` utility
- Passes nonce to theme initialization script via `nonce` prop
- Ensures inline scripts comply with CSP

### 4. **CSP Report Endpoint** (`apps/api/src/routes/csp-report.ts`)
- POST `/api/csp-report` endpoint
- Receives browser CSP violation reports
- Logs violations with full context:
  - Document URI
  - Violated directive
  - Blocked URI
  - Source file and line number
  - Status code
- Ready for integration with monitoring services (Sentry, DataDog, etc.)

### 5. **API Route Registration** (`apps/api/src/routes/index.ts`)
- Registered CSP report route at `/csp-report`
- Mounted early to avoid shadowing

### 6. **Nginx Configuration** (`nginx/templates/nginx.prod.conf.template`)
- Added CSP header with strict allowlist:
  ```
  default-src 'self'
  script-src 'self' 'nonce-$cspNonce'
  img-src 'self' data: https://${CDN_HOST}
  font-src 'self' https://fonts.gstatic.com
  style-src 'self' https://fonts.googleapis.com 'unsafe-inline'
  connect-src 'self' https://${API_HOST}
  frame-ancestors 'none'
  report-uri /api/csp-report
  ```
- Uses environment variables: `${CDN_HOST}`, `${API_HOST}`

### 7. **Environment Variables** (`.env.example`)
- Added `NEXT_PUBLIC_CDN_HOST=assets.brandblitz.app`
- Used by middleware to build CSP header

## CSP Policy Breakdown

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Deny all by default, allow same-origin |
| `script-src` | `'self' 'nonce-$cspNonce'` | Only self + nonce-based inline scripts (XSS protection) |
| `img-src` | `'self' data: https://${CDN_HOST}` | Self, data URIs, and CDN |
| `font-src` | `'self' https://fonts.gstatic.com` | Self and Google Fonts |
| `style-src` | `'self' https://fonts.googleapis.com 'unsafe-inline'` | Self, Google Fonts, inline styles (Tailwind) |
| `connect-src` | `'self' https://${API_HOST}` | API calls to same-origin or API host |
| `frame-ancestors` | `'none'` | Prevent clickjacking |
| `report-uri` | `/api/csp-report` | Violation reporting endpoint |

## Deployment Timeline

### Phase 1: Report-Only (Days 1-7)
- CSP header set to `Content-Security-Policy-Report-Only`
- Violations logged but not blocked
- Monitor `/api/csp-report` endpoint for violations
- Collect data on false positives

### Phase 2: Enforcement (Day 8+)
- Switch header to `Content-Security-Policy` (remove `-Report-Only`)
- Violations now blocked by browser
- Continue monitoring for edge cases

**To switch to enforcement mode:**
1. In `apps/web/src/middleware.ts`, change line:
   ```typescript
   response.headers.set("Content-Security-Policy-Report-Only", cspHeader);
   ```
   to:
   ```typescript
   response.headers.set("Content-Security-Policy", cspHeader);
   ```
2. Deploy and monitor

## Testing CSP

### Local Development
1. Set environment variables:
   ```bash
   NEXT_PUBLIC_CDN_HOST=localhost:9000
   NEXT_PUBLIC_API_URL=http://localhost:3001/api
   ```

2. Test nonce injection:
   ```bash
   curl -i http://localhost:3000
   # Look for x-nonce header in response
   ```

3. Test CSP report endpoint:
   ```bash
   curl -X POST http://localhost:3001/api/csp-report \
     -H "Content-Type: application/json" \
     -d '{"csp-report":{"document-uri":"http://localhost:3000","violated-directive":"script-src"}}'
   ```

### Production Monitoring
1. Check nginx logs for CSP headers
2. Monitor `/api/csp-report` endpoint for violations
3. Set up alerts for script-src violations (potential XSS attempts)

## Security Benefits

✅ **XSS Prevention**: Inline scripts require matching nonce, preventing injected scripts  
✅ **Clickjacking Protection**: `frame-ancestors 'none'` prevents embedding  
✅ **Data Exfiltration Prevention**: `connect-src` limits API calls  
✅ **Violation Monitoring**: Report endpoint enables security incident detection  
✅ **Gradual Rollout**: Report-Only mode allows safe testing before enforcement  

## Next Steps

1. **Deploy to staging** and monitor violations for 7 days
2. **Integrate monitoring**: Send CSP violations to Sentry/DataDog
3. **Review violations**: Check for false positives or legitimate third-party scripts
4. **Switch to enforcement**: Update middleware to use `Content-Security-Policy` header
5. **Document exceptions**: If third-party scripts needed, add to CSP allowlist

## Files Modified

- ✅ `apps/web/src/middleware.ts` — Nonce generation and CSP header injection
- ✅ `apps/web/src/lib/csp.ts` — Nonce retrieval utility (NEW)
- ✅ `apps/web/src/app/layout.tsx` — Nonce injection into theme script
- ✅ `apps/api/src/routes/csp-report.ts` — Violation reporting endpoint (NEW)
- ✅ `apps/api/src/routes/index.ts` — Route registration
- ✅ `nginx/templates/nginx.prod.conf.template` — CSP header in nginx
- ✅ `.env.example` — CDN_HOST environment variable

## Acceptance Criteria Met

✅ CSP with strict allowlist (default-src 'self', script-src 'self' 'nonce-$cspNonce', etc.)  
✅ Next.js nonce-based CSP via middleware  
✅ Report-Only mode for first 7 days  
✅ CSP violation collection at `/api/csp-report` endpoint  
✅ Promotion path to enforce mode documented  
✅ All relevant files updated  

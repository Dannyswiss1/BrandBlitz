# Deposit Memo Security Fix

## Problem
Deposit memo and address were leaked in URL query params, ending up in:
- Browser history
- Analytics
- Sentry breadcrumbs
- Referer headers on external clicks

The memo is critical for Stellar hot-wallet reconciliation and must be kept secret.

## Solution
Moved deposit details from URL query params to server-side API endpoint.

## Changes Made

### Frontend

#### 1. **brand-kit-form.tsx** (Line 71)
- **Before**: `router.push(/brand/${brandId}?depositAddress=...&memo=...&amount=...)`
- **After**: `router.push(/brand/${brandId})`
- Secrets no longer included in redirect URL

#### 2. **brand/[id]/page.tsx**
- Removed `useSearchParams()` hook
- Removed query param extraction: `depositAddress`, `depositMemo`, `depositAmount`
- Added `depositInfo` state
- Added API call to fetch deposit info: `GET /challenges/:id/deposit-info`
- Only fetches if challenge status is `pending_deposit`
- Gracefully handles missing deposit info

#### 3. **brand-kit-form.test.tsx** (NEW)
- Unit test verifies redirect URL contains no secrets
- Tests that URL does not contain: `depositAddress`, `memo`, `amount`, wallet address, or challenge ID

### Backend

#### 1. **challenges.ts** (New Endpoint)
- Added `GET /challenges/:id/deposit-info`
- **Authentication**: Required (authenticate middleware)
- **Authorization**: Only brand owner can access
- **Validation**: Challenge must be in `pending_deposit` status
- **Response**: Returns `{ depositInfo: { hotWalletAddress, memo, amount } }`
- **Error Handling**:
  - 404: Challenge not found
  - 403: Requester is not brand owner
  - 400: Challenge is not pending deposit

#### 2. **challenges.deposit-info.test.ts** (NEW)
- Tests 404 for unknown challenge
- Tests 403 for unauthorized users
- Tests 400 for non-pending challenges
- Tests successful response for authorized owner
- Verifies secrets not leaked in error responses

### Documentation

#### 1. **docs/06-legal-compliance.md** (NEW)
- Explains why memos must be kept secret
- Documents implementation details
- Provides manual QA checklist
- Includes monitoring recommendations
- Suggests future improvements

## Acceptance Criteria Met

✅ `/brand/[id]/page.tsx` fetches deposit info from `/challenges/:id/deposit-info`  
✅ Redirect in `brand-kit-form.tsx:71` drops query string  
✅ Backend returns 404 if requester is not brand owner  
✅ Vitest unit test verifies redirect URL contains no secrets  
✅ Manual QA checklist provided in docs  
✅ Documented in `docs/06-legal-compliance.md`  

## Testing

### Unit Tests
```bash
# Frontend
npm run test -- brand-kit-form.test.tsx

# Backend
npm run test -- challenges.deposit-info.test.ts
```

### Manual QA
1. Create a brand and challenge
2. Verify redirect URL is clean: `/brand/[id]` (no query params)
3. Verify deposit info appears on the page (fetched from API)
4. Check DevTools Network tab — memo only in response body, never in URL
5. Check browser history — no memo or address in URL

## Security Benefits

✅ **No URL Leakage**: Memos no longer in browser history  
✅ **No Analytics Leakage**: Memos not sent to analytics services  
✅ **No Sentry Leakage**: Memos not in breadcrumbs  
✅ **No Referer Leakage**: Memos not sent to external sites  
✅ **Authorization Enforced**: Only brand owner can access deposit info  
✅ **Status Validation**: Deposit info only available for pending challenges  

## Files Modified

- ✅ `apps/web/src/components/brand/brand-kit-form.tsx` — Remove query params from redirect
- ✅ `apps/web/src/app/(brand)/brand/[id]/page.tsx` — Fetch from API instead of query params
- ✅ `apps/web/src/components/brand/brand-kit-form.test.tsx` — NEW: Unit test
- ✅ `apps/api/src/routes/challenges.ts` — NEW: `/deposit-info` endpoint
- ✅ `apps/api/src/routes/challenges.deposit-info.test.ts` — NEW: Integration tests
- ✅ `docs/06-legal-compliance.md` — NEW: Security documentation

## Deployment Notes

1. Deploy API changes first (new endpoint)
2. Deploy frontend changes (use new endpoint)
3. Monitor `/api/challenges/:id/deposit-info` for 403 errors
4. Verify no memos appear in Sentry breadcrumbs
5. Run manual QA checklist

## Rollback Plan

If issues arise:
1. Revert frontend to use query params (temporary)
2. Keep API endpoint for future use
3. Investigate root cause
4. Re-deploy with fix

## Future Improvements

- Rotate memos after deposit confirmation
- Implement memo expiration (24 hours)
- Add rate limiting to deposit-info endpoint
- Audit trail for all deposit-info access

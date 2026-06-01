# FingerprintJS Integration Summary

## What Was Done

Wired FingerprintJS Pro visitorId into the warmup-start payload for anti-cheat device fingerprinting.

## Problem
- `deviceId: undefined` was sent in warmup-start, leaving anti-cheat blind
- Backend couldn't detect multi-account farming
- No device fingerprinting was happening

## Solution
- Integrated FingerprintJS Pro for stable device identification
- Created provider + hook pattern for clean integration
- Graceful fallback if FingerprintJS unavailable

## Changes

### 1. FingerprintProvider (NEW)
**File**: `apps/web/src/components/providers/fingerprint-provider.tsx`
- Initializes FingerprintJS Pro on app load
- Sets up global `fpPromise` for hook access
- Handles missing config gracefully

### 2. useFingerprint Hook (NEW)
**File**: `apps/web/src/hooks/use-fingerprint.ts`
- Retrieves visitorId from FingerprintJS
- Returns null if not configured or fails
- Non-blocking — game proceeds regardless

### 3. Root Layout Update
**File**: `apps/web/src/app/layout.tsx`
- Wrapped app with `<FingerprintProvider>`
- Positioned before `<AuthBoundary>` for early initialization

### 4. Challenge Page Update
**File**: `apps/web/src/app/(game)/challenge/[id]/challenge-page.tsx`
- Calls `useFingerprint()` to get visitorId
- Sends as `deviceId` in warmup-start payload
- Included in dependency array for reactivity

### 5. Environment Variable
**File**: `.env.example`
- Added `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY`
- Optional — fingerprinting disabled if not set

### 6. Tests (NEW)
- **Unit**: `apps/web/src/hooks/use-fingerprint.test.ts`
  - Verifies hook returns null when not configured
  - Verifies SDK not called during tests
  - Tests graceful failure handling

- **E2E**: `e2e/fingerprint.spec.ts`
  - Verifies warmup-start payload contains non-empty deviceId
  - Confirms page renders without errors

## How It Works

```
User plays challenge
    ↓
FingerprintProvider initializes FingerprintJS
    ↓
useFingerprint hook retrieves visitorId
    ↓
Challenge page sends visitorId as deviceId in warmup-start
    ↓
Backend receives deviceId in payload
    ↓
Anti-cheat middleware computes fingerprint from:
  - visitorId (FingerprintJS)
  - IP address (/24 subnet)
  - User-Agent hash
    ↓
Checks Redis for fingerprint collisions (3+ accounts in 24h)
    ↓
Flags multi-account farming attempts
```

## Graceful Degradation

If FingerprintJS fails:
- `visitorId` is null
- `deviceId: null` sent in warmup-start
- Backend flags for manual review
- Game proceeds normally

## Testing

### Unit Tests
```bash
npm run test -- use-fingerprint.test.ts
```

### E2E Tests
```bash
npm run e2e -- fingerprint.spec.ts
```

### Manual Testing
1. Set `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY` in `.env.local`
2. Play a challenge
3. Check DevTools Network → POST `/warmup-start`
4. Verify request body: `{ "deviceId": "visitor-id-here" }`

## Configuration

Get your FingerprintJS public key from: https://dashboard.fingerprint.com

Add to `.env.local` or production env:
```bash
NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY=your-key-here
```

## Acceptance Criteria Met

✅ Installed @fingerprintjs/fingerprintjs-pro-react  
✅ Created FingerprintProvider in app/layout.tsx  
✅ useFingerprint hook inside client component  
✅ Populated deviceId with real visitorId  
✅ Graceful failure handling (null marker)  
✅ Vitest: component renders without calling FP SDK  
✅ Playwright: POST body contains non-empty deviceId  
✅ Documented NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY in .env.example  

## Files Modified

- ✅ `apps/web/src/app/layout.tsx` — Added FingerprintProvider
- ✅ `apps/web/src/components/providers/fingerprint-provider.tsx` — NEW
- ✅ `apps/web/src/hooks/use-fingerprint.ts` — NEW
- ✅ `apps/web/src/hooks/use-fingerprint.test.ts` — NEW
- ✅ `apps/web/src/app/(game)/challenge/[id]/challenge-page.tsx` — Use visitorId
- ✅ `e2e/fingerprint.spec.ts` — NEW
- ✅ `.env.example` — Document env var

## Next Steps

1. Deploy with `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY` set
2. Monitor anti-cheat metrics for 24h
3. Review fraud flags in admin panel
4. Verify no increase in error rates

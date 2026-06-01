# FingerprintJS Integration for Anti-Cheat

## Overview
Integrated FingerprintJS Pro for device fingerprinting to detect multi-account farming. The visitorId is sent with each game session to enable server-side fingerprint collision detection.

## Problem Solved
Previously, `deviceId: undefined` was sent in warmup-start payload, leaving anti-cheat blind to multi-account farming. Now the real FingerprintJS visitorId is captured and sent.

## Architecture

### Frontend Flow
1. **FingerprintProvider** (layout.tsx)
   - Initializes FingerprintJS Pro on app load
   - Sets up global `fpPromise` for hook access
   - Gracefully handles missing config or load failures

2. **useFingerprint Hook** (hooks/use-fingerprint.ts)
   - Retrieves visitorId from FingerprintJS
   - Returns null if not configured or load fails
   - Non-blocking — game proceeds even if fingerprinting fails

3. **Challenge Page** (challenge-page.tsx)
   - Calls `useFingerprint()` to get visitorId
   - Sends visitorId as `deviceId` in warmup-start payload
   - Includes in dependency array to re-fetch if visitorId changes

### Backend Flow
1. **warmup-start Endpoint** (API)
   - Receives `deviceId` (FingerprintJS visitorId) in payload
   - Passes to anti-cheat middleware via `x-device-id` header

2. **validateDeviceFingerprint Middleware** (anti-cheat.ts)
   - Computes server-side fingerprint from:
     - visitorId (from FingerprintJS)
     - IP address (/24 subnet)
     - User-Agent hash
   - Checks Redis for fingerprint collisions (3+ accounts in 24h)
   - Flags multi-account farming attempts

## Configuration

### Environment Variables
```bash
# .env.local or .env.production
NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY=your-fp-public-key
```

Get your public key from: https://dashboard.fingerprint.com

### Optional
- If `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY` is not set, fingerprinting is disabled
- Game proceeds normally, but backend flags sessions without device ID

## Files Changed

### Frontend
- ✅ `apps/web/src/app/layout.tsx` — Added FingerprintProvider wrapper
- ✅ `apps/web/src/components/providers/fingerprint-provider.tsx` — NEW: Provider component
- ✅ `apps/web/src/hooks/use-fingerprint.ts` — NEW: Hook to get visitorId
- ✅ `apps/web/src/hooks/use-fingerprint.test.ts` — NEW: Unit tests
- ✅ `apps/web/src/app/(game)/challenge/[id]/challenge-page.tsx` — Use visitorId in warmup-start
- ✅ `.env.example` — Document NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY

### E2E Tests
- ✅ `e2e/fingerprint.spec.ts` — NEW: Playwright tests

## Testing

### Unit Tests
```bash
npm run test -- use-fingerprint.test.ts
```

Verifies:
- Hook returns null when not configured
- SDK not called during tests
- Graceful failure handling

### Playwright Tests
```bash
npm run e2e -- fingerprint.spec.ts
```

Verifies:
- warmup-start payload contains non-empty deviceId
- Page renders without FingerprintJS errors

### Manual Testing
1. Set `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY` in `.env.local`
2. Start dev server: `npm run dev`
3. Open DevTools Network tab
4. Play a challenge
5. Find POST `/sessions/:id/warmup-start` request
6. Verify request body contains: `{ "deviceId": "your-visitor-id" }`

## Security Considerations

### Data Privacy
- FingerprintJS visitorId is a stable device identifier
- Sent only to your API server (not to third parties)
- Used only for anti-cheat multi-account detection
- Not stored in browser localStorage (only in memory)

### Graceful Degradation
- If FingerprintJS fails to load, `deviceId` is null
- Backend flags null deviceId for manual review
- Game proceeds normally — no blocking

### Rate Limiting
- FingerprintJS API calls are rate-limited by Fingerprint
- Fallback to null if rate limit exceeded
- No impact on gameplay

## Monitoring

### Backend Logs
Monitor for:
- `Missing X-Device-Id header` — Device ID not sent
- `multi_account_fingerprint` — Collision detected (3+ accounts)
- `fingerprint_collision_total` — Metric for collisions

### Metrics
- `antiCheat.fingerprint_collision_total` — Multi-account attempts
- `antiCheat.flags_total` — All anti-cheat flags

## Troubleshooting

### visitorId is null
**Cause**: FingerprintJS not configured or failed to load
**Solution**: 
1. Verify `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY` is set
2. Check browser console for errors
3. Verify API key is valid at https://dashboard.fingerprint.com

### warmup-start fails with 400
**Cause**: Missing `x-device-id` header
**Solution**: Ensure FingerprintProvider is wrapping the app in layout.tsx

### High collision rate
**Cause**: Multiple accounts from same device/IP
**Solution**: Review fraud flags in admin panel, consider IP-based rate limiting

## Future Improvements

1. **Persistent Storage**: Store visitorId in sessionStorage for consistency
2. **Retry Logic**: Retry FingerprintJS load if initial attempt fails
3. **Metrics**: Track FingerprintJS load success rate
4. **Caching**: Cache visitorId for 24h to reduce API calls
5. **Fallback**: Use browser fingerprint library if FingerprintJS unavailable

## Acceptance Criteria Met

✅ Installed @fingerprintjs/fingerprintjs-pro-react  
✅ Created FingerprintProvider in app/layout.tsx  
✅ useFingerprint hook retrieves visitorId  
✅ Populated deviceId with real visitorId  
✅ Graceful failure handling (null marker)  
✅ Vitest: component renders without calling FP SDK  
✅ Playwright: POST body contains non-empty deviceId  
✅ Documented NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY in .env.example  

## Deployment Checklist

- [ ] Add `NEXT_PUBLIC_FINGERPRINT_PUBLIC_KEY` to production env
- [ ] Deploy API changes (if any)
- [ ] Deploy frontend changes
- [ ] Monitor anti-cheat metrics for 24h
- [ ] Verify no increase in error rates
- [ ] Check fraud flag volume
- [ ] Document in runbook

# Legal & Compliance

## Deposit Memo Security

### Overview
Deposit memos are sensitive identifiers used by the Stellar hot-wallet to reconcile which brand funded which challenge pool. These memos **must never be exposed in URLs, browser history, analytics, or logs**.

### Why This Matters
If a deposit memo leaks, an attacker could:
- Intercept the memo from browser history or analytics
- Use it to track which brand funded which challenge
- Potentially manipulate or replay deposit transactions
- Correlate brand activity with user behavior

### Implementation

#### Frontend (Next.js)
- **Before**: Redirect included memo in URL query params: `/brand/[id]?memo=...&depositAddress=...`
- **After**: Redirect is clean: `/brand/[id]` (no query params)
- Deposit info is fetched server-side from `/api/challenges/:id/deposit-info`

#### Backend (API)
- New endpoint: `GET /api/challenges/:id/deposit-info`
- Returns deposit instructions (memo, address, amount) only to authenticated brand owners
- Returns 403 Forbidden if requester is not the brand owner
- Returns 400 Bad Request if challenge is not in `pending_deposit` status

#### Storage
- Memos are stored in the database (`challenges.deposit_memo` column)
- Memos are **never** logged to URLs, query strings, or breadcrumbs
- Memos are only transmitted over HTTPS in response bodies to authenticated users

### Testing
- Unit test: `apps/web/src/components/brand/brand-kit-form.test.tsx`
  - Verifies redirect URL contains no secrets
- Integration test: `apps/api/src/routes/challenges.deposit-info.test.ts`
  - Verifies endpoint returns 403 for unauthorized users
  - Verifies endpoint returns 400 for non-pending challenges
  - Verifies secrets are not leaked in error responses

### Manual QA Checklist
- [ ] Create a brand and challenge
- [ ] Copy the old-style URL with query params (if you have one from before this fix)
- [ ] Paste it into a new browser tab
- [ ] Verify deposit info does NOT appear (should be empty)
- [ ] Refresh the page normally (without query params)
- [ ] Verify deposit info appears correctly
- [ ] Check browser DevTools Network tab — memo should only appear in response body, never in URL
- [ ] Check browser history — URL should not contain memo or address

### Monitoring
- Monitor API logs for 403 errors on `/challenges/:id/deposit-info` (potential unauthorized access attempts)
- Monitor for any memos appearing in Sentry breadcrumbs or error logs
- Audit database access logs for unusual queries on `challenges.deposit_memo`

### Future Improvements
- Consider rotating memos after deposit confirmation
- Implement memo expiration (e.g., memo valid for 24 hours only)
- Add rate limiting to `/challenges/:id/deposit-info` endpoint
- Log all access to deposit-info endpoint for audit trail

# ADR 003: Escrow Contract Implementation in Production Path

## Status

Accepted

## Context

ADR 002 decided to use Soroban escrow contracts for prize-pool custody. However, the implementation was incomplete:
- The contract existed but was never called from the API
- No wrapper library existed to interact with the contract
- The payout service used direct hot-wallet transfers instead of contract settlement
- Deployment scripts were missing

This left the system in a hybrid state: non-custodial on paper, but custodial in practice.

## Decision

Implement full escrow integration in the production payout path:

1. **Escrow for all challenges** (not just high-value)
   - Simplifies logic: one settlement path
   - Maximizes non-custodial benefits
   - Reduces hot-wallet exposure

2. **Graceful fallback to direct transfers**
   - If `SOROBAN_CONTRACT_ID` is not configured, use direct transfers
   - Allows gradual rollout and testing
   - Enables quick recovery if contract has issues

3. **Wrapper library** (`packages/stellar/src/escrow.ts`)
   - Encapsulates Soroban SDK complexity
   - Provides clean API: `initialize()`, `deposit()`, `settle()`, `refund()`
   - Handles transaction signing and submission

## Implementation

### 1. EscrowClient Wrapper
**File**: `packages/stellar/src/escrow.ts`

Provides:
- `initialize(admin, token, memo, signerSecret)` — Set up contract for challenge
- `deposit(depositor, amountStroops, signerSecret)` — Brand funds pool
- `settle(recipients, signerSecret)` — Distribute to winners (atomic)
- `refund(signerSecret)` — Return funds if challenge cancelled
- `getBalance()` — View current balance
- `isSettled()` — View settlement status

### 2. Payout Service Integration
**File**: `apps/api/src/services/payout.ts`

Modified `processPayout()` to:
1. Check if `SOROBAN_CONTRACT_ID` is configured
2. If yes: use `EscrowClient.settle()` for atomic distribution
3. If no: fall back to `submitBatchPayout()` (direct transfers)
4. Log which path was used for debugging

### 3. Deployment Script
**File**: `contracts/contracts/escrow/Makefile`

Added targets:
- `make deploy-testnet` — Deploy to Stellar testnet
- `make deploy-mainnet` — Deploy to Stellar mainnet

Requires:
- `STELLAR_ACCOUNT` env var (signer account)
- `stellar` CLI installed

### 4. Configuration
**File**: `.env.example`

Added:
- `SOROBAN_CONTRACT_ID` — Contract ID after deployment
- `STELLAR_RPC_URL` — Soroban RPC endpoint

## Rationale

### Why Escrow for All Challenges?
- **Consistency**: One settlement path, easier to reason about
- **Non-custodial**: Maximizes the benefit of ADR 002
- **Atomic**: All-or-nothing distribution prevents partial payouts
- **Auditable**: On-chain proof of settlement

### Why Graceful Fallback?
- **Safety**: Can disable escrow if contract has bugs
- **Testing**: Allows staging environment to test without contract
- **Rollout**: Can enable escrow gradually per environment
- **Recovery**: Quick path if Soroban RPC is down

### Why Wrapper Library?
- **Abstraction**: Hides Soroban SDK complexity
- **Reusability**: Can be used by other services (deposit-monitor, etc.)
- **Testing**: Easier to mock for unit tests
- **Maintenance**: Single source of truth for contract interaction

## Consequences

### Positive
- ✅ Non-custodial by default (reduces regulatory risk)
- ✅ Atomic settlement (no partial-payout bugs)
- ✅ On-chain auditability (disputes resolved against contract)
- ✅ Graceful degradation (works without contract)

### Negative
- ⚠️ Soroban RPC dependency (another service to monitor)
- ⚠️ Gas costs (platform pays for settlement transactions)
- ⚠️ Contract upgrade complexity (requires Wasm update + ADR)
- ⚠️ Testnet-only initially (mainnet deployment requires audit)

## Deployment Checklist

### Testnet
- [ ] Deploy contract: `cd contracts/contracts/escrow && make deploy-testnet`
- [ ] Set `SOROBAN_CONTRACT_ID` in `.env.test`
- [ ] Run integration tests
- [ ] Monitor payout service logs for 24h
- [ ] Verify all payouts use escrow path

### Staging
- [ ] Deploy contract to staging Soroban
- [ ] Set `SOROBAN_CONTRACT_ID` in staging env
- [ ] Run full end-to-end test (brand deposit → challenge → payout)
- [ ] Monitor for 7 days

### Mainnet
- [ ] Audit contract code (external security firm)
- [ ] Deploy contract: `cd contracts/contracts/escrow && make deploy-mainnet`
- [ ] Set `SOROBAN_CONTRACT_ID` in production env
- [ ] Run canary: one challenge with escrow
- [ ] Monitor for 24h
- [ ] Gradually roll out to all challenges

## Monitoring

### Metrics
- `payout.escrow_settlement_total` — Successful escrow settlements
- `payout.escrow_settlement_failed_total` — Failed escrow settlements
- `payout.fallback_direct_transfer_total` — Fallback to direct transfers
- `payout.settlement_latency_ms` — Time to settle

### Alerts
- Alert if `escrow_settlement_failed_total` > 0 in 1h
- Alert if `fallback_direct_transfer_total` > 0 (indicates contract issues)
- Alert if `settlement_latency_ms` > 60s (Soroban RPC slow)

### Logs
- Log contract ID and tx hash for every settlement
- Log fallback reason if direct transfer used
- Log gas costs for cost tracking

## Testing

### Unit Tests
- Mock EscrowClient for payout service tests
- Verify fallback logic when contract ID not set

### Integration Tests
- Deploy contract to testnet
- Initialize, deposit, settle, verify balances
- Test refund path
- Test error handling (insufficient balance, etc.)

### E2E Tests
- Full flow: brand creates challenge → deposits → plays → settles
- Verify winner receives USDC from contract
- Verify contract balance decreases

## Future Improvements

1. **Batch initialization**: Initialize multiple contracts in one tx
2. **Grace period enforcement**: Contract enforces refund window
3. **Multi-sig settlement**: Require multiple signers for large payouts
4. **Contract upgrades**: Implement proxy pattern for seamless upgrades
5. **Gas optimization**: Reduce settlement gas costs via batching

## References

- ADR 002: USDC Prize-Pool Escrow on Stellar Soroban
- `packages/stellar/src/escrow.ts` — Wrapper implementation
- `apps/api/src/services/payout.ts` — Integration point
- `contracts/contracts/escrow/` — Contract source
- Stellar Soroban docs: https://developers.stellar.org/docs/learn/soroban

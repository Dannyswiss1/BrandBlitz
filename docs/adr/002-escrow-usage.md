# ADR 002: USDC Prize-Pool Escrow on Stellar Soroban (#65)

## Status

Accepted

## Context

BrandBlitz's challenge model pays winners in USDC. Two flows had to
land before payouts could go live:

- A way for a brand to fund a prize pool that the platform cannot
  silently re-direct.
- A way for winners to actually withdraw their share once the
  challenge ends.

Holding the pool in a custodial wallet under platform control would
have been the fastest path to ship, but it makes the platform a money-
transmitter risk and asks every brand to trust a single signer. We
also wanted on-chain provenance for the prize pool size in case of
disputes.

## Decision

Prize pools are escrowed in a Soroban smart contract on Stellar.

- The brand calls `deposit(amount)` on the escrow contract; the
  contract takes custody of USDC and emits a `Funded` event the
  backend indexes.
- The backend's deposit-monitor service watches Soroban events and
  marks the challenge as funded once `amount >= challenge.pool_amount_usdc`.
- At settlement, the backend calls `release(distribution[])` with the
  pre-computed winner addresses + shares. The contract pulls from its
  own balance and pushes to each winner atomically.
- The brand can call `refund_unclaimed()` only after a configured
  grace period; the contract enforces the grace window so winners
  can't be back-billed by a brand cancelling early.

## Rationale

- **Non-custodial**: the platform never holds the pool, so we
  inherit none of the money-transmitter risk.
- **Auditable**: the prize-pool size is visible on-chain. Disputes
  resolve against the contract state, not the platform's database.
- **Atomic settlement**: `release` distributes to all winners in a
  single transaction; a partial-payout outage isn't possible.
- **Refund safety**: the grace-period gate prevents brands from
  reclaiming an unclaimed pool while winners are still verifying.

Considered alternatives:

- **Custodial USDC**: simpler, but money-transmitter-shaped. Rejected.
- **Native XLM escrow**: free, but the prize pool's USD value swings
  with XLM price. Rejected.
- **Off-chain promise + on-chain claim**: forces every winner to
  trust the platform's solvency. Rejected.

## Consequences

- The deposit-monitor service is now load-bearing: a stalled indexer
  blocks every challenge launch. SLOs + alerting required.
- Settlement gas costs are paid by the platform's signer key, not
  the brand. Budget line item.
- The escrow contract is a first-class deploy artifact; upgrades go
  through the Soroban Wasm-upgrade flow with audit + ADR.
- Withdrawal requires winners to hold a Stellar account (we sponsor
  account creation as a one-time cost when needed).
- The grace-period parameter is a per-challenge field; product can
  tune it without a contract upgrade.

## References

- `apps/api/src/services/escrow.ts`
- `apps/deposit-monitor/`
- `contracts/escrow/`
- Closes #65.

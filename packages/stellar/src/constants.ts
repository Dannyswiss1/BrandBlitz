export const STELLAR_NETWORKS = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  public: {
    rpcUrl: "https://mainnet.stellar.validationcloud.io/v1/rpc",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
} as const;

export type NetworkName = keyof typeof STELLAR_NETWORKS;

export const MAX_OPS_PER_TX = 50; // safe limit (protocol allows 100)
export const PAYOUT_BATCH_DELAY_MS = 2000; // avoid sequence conflicts
export const DEPOSIT_POLL_INTERVAL_MS = 5000;
export const WARMUP_MIN_SECONDS = 20;
export const CHALLENGE_SECONDS = 45;
export const ROUND_SECONDS = 15;
export const MAX_ROUNDS = 3;

// Minimum pool amount in stroops (100 USDC = 1,000,000,000 stroops)
// Used by challenge creation validation to prevent dust-level prize pools
export const MIN_POOL_STROOPS = 1_000_000_000;

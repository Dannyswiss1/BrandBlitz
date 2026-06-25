import https from "https";
import http from "http";
import {
  Horizon,
  Keypair,
  Asset,
  Networks,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { STELLAR_NETWORKS, type NetworkName } from "./constants";

export function getNetworkConfig(name: NetworkName = "testnet") {
  const config = STELLAR_NETWORKS[name];
  if (!config) {
    throw new Error(`Invalid network name: ${name}`);
  }
  return config;
}

// Backward-compat alias.
export const getNetwork = getNetworkConfig;
const maxSockets = Number(process.env.STELLAR_MAX_SOCKETS ?? "32");

// One shared agent for all Horizon + Soroban HTTPS connections.
// Avoids per-call TCP+TLS handshake; sized to env STELLAR_MAX_SOCKETS (default 32).
export const sharedAgent = new https.Agent({
  keepAlive: true,
  maxSockets,
  maxFreeSockets: Math.ceil(maxSockets / 4),
});

const sharedHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets,
  maxFreeSockets: Math.ceil(maxSockets / 4),
});

// Wire the agent into Horizon's shared axios client when the SDK exposes it so
// every Horizon.Server instance created in this process reuses the connection
// pool. Stellar SDK versions differ on whether this singleton is public.
if (Horizon.AxiosClient?.defaults) {
  Horizon.AxiosClient.defaults.httpsAgent = sharedAgent;
  Horizon.AxiosClient.defaults.httpAgent = sharedHttpAgent;
}

/** Call on process shutdown to drain in-flight requests and close sockets. */
export function drainSharedAgent(): void {
  sharedAgent.destroy();
  sharedHttpAgent.destroy();
}

export function getHorizonServer(network: NetworkName = "testnet"): Horizon.Server {
  const { horizonUrl } = getNetwork(network);
  return new Horizon.Server(horizonUrl, { allowHttp: network === "testnet" });
}

export function getRpcServer(network: NetworkName = "testnet"): SorobanRpc.Server {
  const { rpcUrl } = getNetwork(network);
  return new SorobanRpc.Server(rpcUrl, { allowHttp: network === "testnet" });
}

export function getUsdcAsset(network: NetworkName = "testnet"): Asset {
  const { usdcIssuer } = getNetwork(network);
  return new Asset("USDC", usdcIssuer);
}

export function getNetworkPassphrase(network: NetworkName = "testnet"): string {
  return getNetwork(network).networkPassphrase;
}

export type { NetworkName };
export { Keypair, Asset, TransactionBuilder, BASE_FEE, Networks };

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

export const getNetwork = getNetworkConfig;

export function getHorizonServer(network: NetworkName = "testnet"): Horizon.Server {
  const { horizonUrl } = getNetworkConfig(network);
  return new Horizon.Server(horizonUrl, { allowHttp: network === "testnet" });
}

export function getRpcServer(network: NetworkName = "testnet"): SorobanRpc.Server {
  const { rpcUrl } = getNetworkConfig(network);
  return new SorobanRpc.Server(rpcUrl, { allowHttp: network === "testnet" });
}

export function getUsdcAsset(network: NetworkName = "testnet"): Asset {
  const { usdcIssuer } = getNetworkConfig(network);
  return new Asset("USDC", usdcIssuer);
}

export function getNetworkPassphrase(network: NetworkName = "testnet"): string {
  return STELLAR_NETWORKS[network].networkPassphrase;
}

export type { NetworkName };
export { Keypair, Asset, TransactionBuilder, BASE_FEE, Networks };

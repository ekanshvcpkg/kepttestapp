// Every environment value, in ONE place. Values come from `.env` (see `.env.example`).
// Expo only inlines `process.env.EXPO_PUBLIC_*` when accessed with this exact dot syntax.

import { PublicKey } from "@solana/web3.js";

export type Cluster = "devnet" | "testnet" | "mainnet-beta";

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing ${name}. Copy app/.env.example to app/.env and fill it in.`);
  }
  return value.trim();
}

const cluster = required("EXPO_PUBLIC_CLUSTER", process.env.EXPO_PUBLIC_CLUSTER) as Cluster;
if (!["devnet", "testnet", "mainnet-beta"].includes(cluster)) {
  throw new Error(`EXPO_PUBLIC_CLUSTER must be devnet, testnet or mainnet-beta (got "${cluster}")`);
}

export const config = {
  rpcUrl: required("EXPO_PUBLIC_RPC_URL", process.env.EXPO_PUBLIC_RPC_URL),
  cluster,
  programId: new PublicKey(required("EXPO_PUBLIC_PROGRAM_ID", process.env.EXPO_PUBLIC_PROGRAM_ID)),
  appIdentity: {
    name: required("EXPO_PUBLIC_APP_IDENTITY_NAME", process.env.EXPO_PUBLIC_APP_IDENTITY_NAME),
    uri: required("EXPO_PUBLIC_APP_IDENTITY_URI", process.env.EXPO_PUBLIC_APP_IDENTITY_URI),
  },
  backendUrl: (process.env.EXPO_PUBLIC_BACKEND_URL || "http://10.0.2.2:3000").replace(/\/$/, ""),
  stakeMint: process.env.EXPO_PUBLIC_STAKE_MINT || "",
  treasuryTokenAccount: process.env.EXPO_PUBLIC_TREASURY_TOKEN_ACCOUNT || "",
} as const;

/** MWA chain id, e.g. "solana:devnet". */
export const walletChain = `solana:${config.cluster}` as const;

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${config.cluster}`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${config.cluster}`;
}

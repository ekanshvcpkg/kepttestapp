// Read-only access to the on-chain Keeper (kept_test program) and to transactions.
// Offsets match `Keeper` in kept-example/program/.../state.rs (126 bytes).

import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";

import { config } from "../config.js";

const KEEPER_SEED = Buffer.from("keeper");
const KEEPER_SIZE = 126;
const DISCRIMINATOR = createHash("sha256").update("account:Keeper").digest().subarray(0, 8);

export const connection = new Connection(config.devnetRpcUrl, "confirmed");
const programId = () => new PublicKey(config.keeperProgramId);

export type KeeperView = { address: PublicKey; authority: PublicKey; xpTotal: bigint };

export function keeperPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([KEEPER_SEED, authority.toBuffer()], programId())[0];
}

export function decodeKeeper(address: PublicKey, data: Buffer): KeeperView {
  if (data.length < KEEPER_SIZE || !data.subarray(0, 8).equals(DISCRIMINATOR)) {
    throw new Error("Not a Keeper account");
  }
  return {
    address,
    authority: new PublicKey(data.subarray(8, 40)),
    xpTotal: data.readBigUInt64LE(40),
  };
}

/** A Keeper by PDA address, verified: owned by our program and the PDA of its own authority. */
export async function fetchKeeperAt(address: PublicKey): Promise<KeeperView | null> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(programId())) throw new Error("Account is not owned by the keeper program");
  const keeper = decodeKeeper(address, info.data);
  if (!keeperPda(keeper.authority).equals(address)) {
    throw new Error("Keeper address does not match its authority's PDA");
  }
  return keeper;
}

/** Log messages of a successful transaction, or null if missing / failed on chain. */
export async function successfulTxLogs(signature: string): Promise<string[] | null> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) return null;
  return tx.meta?.logMessages ?? [];
}

import { PublicKey } from "@solana/web3.js";

import { config } from "../config";

const KEEPER_SEED = Buffer.from("keeper");

/** The Keeper PDA for a wallet: seeds [b"keeper", authority]. */
export function keeperPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([KEEPER_SEED, authority.toBuffer()], config.programId)[0];
}

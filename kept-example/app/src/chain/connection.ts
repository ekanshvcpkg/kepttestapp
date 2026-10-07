import { Connection } from "@solana/web3.js";

import { config } from "../config";

/** The single RPC connection the app uses. */
export const connection = new Connection(config.rpcUrl, "confirmed");

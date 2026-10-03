import { Connection } from "@solana/web3.js";
import { config } from "./config.js";

const connection = new Connection(config.devnetRpcUrl, "confirmed");

export type VerifyResult =
  | { ok: true; payerAddress: string; lamports: number }
  | { ok: false; status: 404 | 422; reason: string };

/**
 * The only thing this backend ever trusts: what Devnet RPC itself reports for
 * a given signature. Recipient and amount are both checked via the treasury
 * account's balance delta, not via instruction data — that delta can't be
 * spoofed by a client no matter what it claims.
 */
export async function verifyTransactionOnChain(
  signature: string,
  expectedLamports: number,
): Promise<VerifyResult> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return { ok: false, status: 404, reason: "Transaction not found or not yet confirmed" };
  }

  if (tx.meta?.err) {
    return { ok: false, status: 422, reason: "Transaction failed on-chain" };
  }

  const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const treasuryIndex = accountKeys.findIndex((key) => key.toBase58() === config.treasuryAddress);

  if (treasuryIndex === -1) {
    return { ok: false, status: 422, reason: "Treasury address was not involved in this transaction" };
  }

  const preBalances = tx.meta!.preBalances;
  const postBalances = tx.meta!.postBalances;
  const lamportsReceived = postBalances[treasuryIndex] - preBalances[treasuryIndex];

  if (lamportsReceived !== expectedLamports) {
    return {
      ok: false,
      status: 422,
      reason: `Expected ${expectedLamports} lamports to the treasury, found ${lamportsReceived}`,
    };
  }

  // Fee payer / first signer — derived from the transaction itself, never from client input.
  const payerAddress = accountKeys[0].toBase58();

  return { ok: true, payerAddress, lamports: lamportsReceived };
}

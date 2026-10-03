// From a transaction signature (or a wallet) to "mint what that wallet has earned".
// Nothing from a webhook body is trusted: the tx is re-fetched, the event is re-parsed from
// its logs, and the level comes from the Keeper account on chain.

import { PublicKey } from "@solana/web3.js";

import { config } from "../config.js";
import { KeeperView, fetchKeeperAt, keeperPda, successfulTxLogs } from "./chain.js";
import { levelFromXp } from "./curve.js";
import { parseCheckedInEvents } from "./events.js";
import { AuraMinter, AuraStore, SyncOutcome, syncAuras } from "./service.js";

export type ProcessDeps = {
  store: AuraStore;
  minter: AuraMinter;
  getLogs?: (signature: string) => Promise<string[] | null>;
  getKeeper?: (address: PublicKey) => Promise<KeeperView | null>;
};

export type WalletResult = { wallet: string; level: number; xpTotal: string; outcomes: SyncOutcome[] };

/** Mints everything `keeper`'s on-chain XP has earned. */
export async function syncKeeper(deps: ProcessDeps, keeper: KeeperView): Promise<WalletResult> {
  const level = levelFromXp(keeper.xpTotal);
  const wallet = keeper.authority.toBase58();
  const outcomes = await syncAuras(deps, wallet, level);
  return { wallet, level, xpTotal: keeper.xpTotal.toString(), outcomes };
}

export async function syncWallet(deps: ProcessDeps, wallet: PublicKey): Promise<WalletResult | null> {
  const keeper = await (deps.getKeeper ?? fetchKeeperAt)(keeperPda(wallet));
  return keeper ? syncKeeper(deps, keeper) : null;
}

/** Handles one transaction signature from a webhook. */
export async function syncSignature(deps: ProcessDeps, signature: string): Promise<WalletResult[]> {
  const logs = await (deps.getLogs ?? successfulTxLogs)(signature);
  if (!logs) return [];
  const addresses = new Map<string, PublicKey>();
  for (const ev of parseCheckedInEvents(logs, config.keeperProgramId)) {
    const pda = new PublicKey(ev.keeperBytes);
    addresses.set(pda.toBase58(), pda);
  }
  const results: WalletResult[] = [];
  for (const pda of addresses.values()) {
    const keeper = await (deps.getKeeper ?? fetchKeeperAt)(pda);
    if (keeper) results.push(await syncKeeper(deps, keeper));
  }
  return results;
}

/** Pulls signatures out of a Helius payload (enhanced: `signature`, raw: `transaction.signatures[0]`). */
export function signaturesFromWebhook(body: unknown): string[] {
  const items = Array.isArray(body) ? body : [body];
  const sigs = new Set<string>();
  for (const item of items) {
    const it = item as { signature?: unknown; transaction?: { signatures?: unknown[] } } | null;
    const s = it?.signature ?? it?.transaction?.signatures?.[0];
    if (typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s)) sigs.add(s);
  }
  return [...sigs];
}

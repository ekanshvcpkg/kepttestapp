// The Aura mint-once logic, free of Prisma/Solana so it is fully testable.

import { Milestone, earnedMilestones } from "./milestones.js";

export type AuraStatus = "MINTING" | "MINTED" | "FAILED";

export type AuraRecord = {
  id: number;
  walletAddress: string;
  milestoneId: string;
  levelAtMint: number;
  status: AuraStatus;
  assetId: string | null;
  mintSignature: string | null;
  error: string | null;
};

export interface AuraStore {
  list(wallet: string): Promise<AuraRecord[]>;
  /**
   * Atomically claims (wallet, milestone) for minting. Returns the claimed row, or null if it
   * is already MINTING/MINTED. A FAILED row is re-claimed (flipped back to MINTING).
   */
  claim(wallet: string, milestone: Milestone, level: number): Promise<AuraRecord | null>;
  markMinted(id: number, assetId: string | null, signature: string): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
}

export interface AuraMinter {
  mint(owner: string, milestone: Milestone): Promise<{ signature: string; assetId: string | null }>;
}

export type SyncOutcome = { milestoneId: string; result: "minted" | "failed"; detail: string };

/**
 * Mints every milestone `level` has earned that has not been minted (or is FAILED).
 * Idempotent: safe to call from webhooks, retries and manual sync at the same time.
 */
export async function syncAuras(
  deps: { store: AuraStore; minter: AuraMinter },
  wallet: string,
  level: number,
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const milestone of earnedMilestones(level)) {
    const row = await deps.store.claim(wallet, milestone, level);
    if (!row) continue; // already minted or in flight
    let minted: { signature: string; assetId: string | null };
    try {
      minted = await deps.minter.mint(wallet, milestone);
    } catch (e) {
      // Nothing was minted, so FAILED (retryable) is correct.
      const message = e instanceof Error ? e.message : String(e);
      await deps.store.markFailed(row.id, message).catch(() => undefined);
      outcomes.push({ milestoneId: milestone.id, result: "failed", detail: message });
      continue;
    }
    // The mint HAS happened on chain. If recording it fails, the row stays MINTING (which is
    // never auto-retried) instead of FAILED, so a bookkeeping error can never cause a re-mint.
    try {
      await deps.store.markMinted(row.id, minted.assetId, minted.signature);
    } catch (e) {
      console.error(`[aura] minted ${milestone.id} for ${wallet} (${minted.signature}) but could not record it:`, e);
    }
    outcomes.push({ milestoneId: milestone.id, result: "minted", detail: minted.signature });
  }
  return outcomes;
}

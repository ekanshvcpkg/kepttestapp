import { createHash } from "node:crypto";

// Anchor emits `emit!(CheckedIn {...})` as a log line "Program data: <base64>" whose first 8
// bytes are sha256("event:CheckedIn")[..8]. Layout after that (see kept_test events.rs):
//   keeper Pubkey(32) day i64 quest_slot u8 tier u8 proven bool xp_awarded u16
//   xp_total_after u64 streak_after u16 proof_hash [u8;32]
const DISCRIMINATOR = createHash("sha256").update("event:CheckedIn").digest().subarray(0, 8);
const PREFIX = "Program data: ";
const EVENT_LEN = 8 + 32 + 8 + 1 + 1 + 1 + 2 + 8 + 2 + 32;

export type CheckedInEvent = { keeperBytes: Buffer; xpTotalAfter: bigint };

/**
 * Extracts CheckedIn events from a transaction's log messages. Only lines emitted while OUR
 * program is the innermost running program count, so another program cannot spoof an event
 * by logging the same bytes.
 */
export function parseCheckedInEvents(logs: readonly string[], programId: string): CheckedInEvent[] {
  const stack: string[] = [];
  const out: CheckedInEvent[] = [];
  for (const line of logs) {
    const invoke = line.match(/^Program (\w+) invoke \[\d+\]$/);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith(PREFIX) || stack[stack.length - 1] !== programId) continue;
    const data = Buffer.from(line.slice(PREFIX.length), "base64");
    if (data.length < EVENT_LEN || !data.subarray(0, 8).equals(DISCRIMINATOR)) continue;
    out.push({
      keeperBytes: data.subarray(8, 40),
      xpTotalAfter: data.readBigUInt64LE(8 + 32 + 8 + 1 + 1 + 1 + 2),
    });
  }
  return out;
}

/** Test helper: builds the exact log line the program would emit. */
export function encodeCheckedInLog(keeper: Buffer, xpTotalAfter: bigint): string {
  const b = Buffer.alloc(EVENT_LEN);
  DISCRIMINATOR.copy(b, 0);
  keeper.copy(b, 8);
  b.writeBigUInt64LE(xpTotalAfter, 8 + 32 + 8 + 1 + 1 + 1 + 2);
  return PREFIX + b.toString("base64");
}

// Typed read/write wrappers: one function per action. Screens call these, never Anchor.
// Every write logs: TX sent (args) -> TX confirmed (signature + explorer) -> ACCOUNT diff.

import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

import { explorerTxUrl } from "../config";
import { NEVER_DAY, PROOF_HASH_BYTES, TierName } from "../constants";
import { log, pretty } from "../debug/log";
import { derive } from "../progress/curve";
import { explainError } from "./errors";
import { keeperPda } from "./pda";
import { program } from "./program";
import { signAndSend } from "./wallet";

/** Every stored field of the on-chain Keeper, as exact strings/numbers (no BN leaks out). */
export type KeeperState = {
  address: string;
  authority: string;
  xpTotal: bigint;
  questsKeptTotal: number;
  streakCurrent: number;
  streakBest: number;
  lastCheckinDay: bigint;
  todayMask: number;
  xpToday: number;
  xpTodayDay: bigint;
  soulEarned: bigint;
  soulBought: bigint;
  oathsCompleted: number;
  oathsFailed: number;
  tzOffsetMinutes: number;
  bump: number;
};

/** Field order and labels used by the diff and the state panel. */
export const KEEPER_FIELDS: ReadonlyArray<[keyof KeeperState, string]> = [
  ["authority", "authority"],
  ["xpTotal", "xp_total"],
  ["questsKeptTotal", "quests_kept_total"],
  ["streakCurrent", "streak_current"],
  ["streakBest", "streak_best"],
  ["lastCheckinDay", "last_checkin_day"],
  ["todayMask", "today_mask"],
  ["xpToday", "xp_today"],
  ["xpTodayDay", "xp_today_day"],
  ["soulEarned", "soul_earned"],
  ["soulBought", "soul_bought"],
  ["oathsCompleted", "oaths_completed"],
  ["oathsFailed", "oaths_failed"],
  ["tzOffsetMinutes", "tz_offset_minutes"],
  ["bump", "bump"],
];

export function formatField(key: keyof KeeperState, value: KeeperState[keyof KeeperState]): string {
  if (key === "todayMask") return `0x${(value as number).toString(16).padStart(2, "0")}`;
  if ((key === "lastCheckinDay" || key === "xpTodayDay") && String(value) === NEVER_DAY) return "never";
  return String(value);
}

// ---- live snapshot shared with the debug console's state panel ----

let current: KeeperState | null = null;
const listeners = new Set<() => void>();

export const keeperSnapshot = {
  get: () => current,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

function setCurrent(next: KeeperState | null) {
  current = next;
  for (const l of listeners) l();
}

// ---- reads ----

const big = (v: BN | number) => BigInt(v.toString());

export async function fetchKeeper(authority: PublicKey): Promise<KeeperState | null> {
  const address = keeperPda(authority);
  const raw = await program.account.keeper.fetchNullable(address, "confirmed");
  if (!raw) return null;
  return {
    address: address.toBase58(),
    authority: raw.authority.toBase58(),
    xpTotal: big(raw.xpTotal),
    questsKeptTotal: raw.questsKeptTotal,
    streakCurrent: raw.streakCurrent,
    streakBest: raw.streakBest,
    lastCheckinDay: big(raw.lastCheckinDay),
    todayMask: raw.todayMask,
    xpToday: raw.xpToday,
    xpTodayDay: big(raw.xpTodayDay),
    soulEarned: big(raw.soulEarned),
    soulBought: big(raw.soulBought),
    oathsCompleted: raw.oathsCompleted,
    oathsFailed: raw.oathsFailed,
    tzOffsetMinutes: raw.tzOffsetMinutes,
    bump: raw.bump,
  };
}

/** Reads the Keeper, updates the state panel, and logs the read. */
export async function refreshKeeper(authority: PublicKey): Promise<KeeperState | null> {
  try {
    const k = await fetchKeeper(authority);
    setCurrent(k);
    if (!k) {
      log.account("Keeper not found", `No account at ${keeperPda(authority).toBase58()}.\nTap Init Keeper.`);
    } else {
      log.account("Keeper read", KEEPER_FIELDS.map(([key, label]) => `${label.padEnd(18)} ${formatField(key, k[key])}`).join("\n"));
    }
    return k;
  } catch (e) {
    const { raw, meaning } = explainError(e);
    log.error("Keeper read failed", meaning, raw);
    throw e;
  }
}

export function clearKeeperSnapshot() {
  setCurrent(null);
}

// ---- diff ----

export function diffKeeper(before: KeeperState | null, after: KeeperState): string[] {
  const lines: string[] = [];
  for (const [key, label] of KEEPER_FIELDS) {
    const a = before ? formatField(key, before[key]) : "(none)";
    const b = formatField(key, after[key]);
    if (a !== b) lines.push(`${label.padEnd(18)} ${a.padStart(8)}  →  ${b}`);
  }
  return lines;
}

function logDerived(before: KeeperState | null, after: KeeperState) {
  const d0 = before ? derive(before.xpTotal) : null;
  const d1 = derive(after.xpTotal);
  const line = (label: string, a: string | number | undefined, b: string | number) =>
    `${label.padEnd(16)} ${String(a ?? "(none)").padStart(6)}  →  ${b}`;
  const changed = !d0 || d0.level !== d1.level || d0.rank !== d1.rank;
  log.derive(
    changed ? `Level ${d1.level} · Rank ${d1.rank} (changed)` : `Level ${d1.level} · Rank ${d1.rank} (unchanged)`,
    [
      "Computed on the device from xp_total. Not stored on chain.",
      line("level", d0?.level, d1.level),
      line("rank", d0?.rank, d1.rank),
      line("xp_into_level", d0?.xpIntoLevel, d1.xpIntoLevel),
      line("xp_for_next", d0?.xpForNextLevel, d1.xpForNextLevel),
    ].join("\n"),
  );
}

// ---- writes ----

async function runWrite(
  name: string,
  authority: PublicKey,
  args: Record<string, unknown>,
  build: () => Promise<Parameters<typeof signAndSend>[1]>,
): Promise<KeeperState | null> {
  log.tx(`${name} sent`, pretty({ instruction: name, signer: authority.toBase58(), keeper: keeperPda(authority).toBase58(), args }));
  try {
    const before = await fetchKeeper(authority);
    const signature = await signAndSend(authority, await build());
    log.tx("TX confirmed", `signature ${signature}\n${explorerTxUrl(signature)}`, {
      copyValue: signature,
      url: explorerTxUrl(signature),
    });

    const after = await fetchKeeper(authority);
    setCurrent(after);
    if (!after) {
      log.error("Keeper missing after write", "The transaction confirmed but the account could not be read back.", "fetch returned null");
      return null;
    }
    const diff = diffKeeper(before, after);
    log.account(
      diff.length ? `Keeper updated (${diff.length} field${diff.length === 1 ? "" : "s"})` : "Keeper unchanged",
      diff.length ? diff.join("\n") : "No stored field changed.",
    );
    logDerived(before, after);
    return after;
  } catch (e) {
    const { raw, meaning } = explainError(e);
    log.error(`${name} failed`, meaning, raw);
    throw e;
  }
}

export async function initKeeper(authority: PublicKey, tzOffsetMinutes: number) {
  // A wallet can only ever have one Keeper. Sending init again can never succeed, so do not.
  const existing = await fetchKeeper(authority);
  if (existing) {
    setCurrent(existing);
    log.account(
      "Keeper already exists, init skipped",
      `This wallet already has a Keeper at ${existing.address}.\nNothing was sent. Its current state is in the panel above.`,
    );
    return existing;
  }
  return runWrite("init_keeper", authority, { tz_offset_minutes: tzOffsetMinutes }, () =>
    program.methods
      .initKeeper(tzOffsetMinutes)
      .accountsPartial({ keeper: keeperPda(authority), authority })
      .instruction(),
  );
}

export function checkIn(
  authority: PublicKey,
  args: { questSlot: number; tier: TierName; proven: boolean },
) {
  const proofHash = Array.from(crypto.getRandomValues(new Uint8Array(PROOF_HASH_BYTES)));
  const tier = { [args.tier]: {} } as never;
  return runWrite(
    "check_in",
    authority,
    {
      quest_slot: args.questSlot,
      tier: args.tier,
      proven: args.proven,
      proof_hash: `0x${Buffer.from(proofHash).toString("hex")}`,
    },
    () =>
      program.methods
        .checkIn(args.questSlot, tier, args.proven, proofHash)
        .accountsPartial({ keeper: keeperPda(authority), authority })
        .instruction(),
  );
}

export function buySoul(authority: PublicKey, amount: bigint) {
  return runWrite("buy_soul", authority, { amount: amount.toString() }, () =>
    program.methods
      .buySoul(new BN(amount.toString()))
      .accountsPartial({ keeper: keeperPda(authority), authority })
      .instruction(),
  );
}

/** DEBUG ONLY: moves the Keeper's local day by `days` (shifts tz_offset_minutes by days*1440). */
export function shiftDay(authority: PublicKey, days: number) {
  return runWrite("debug_shift_day", authority, { days }, () =>
    program.methods
      .debugShiftDay(days)
      .accountsPartial({ keeper: keeperPda(authority), authority })
      .instruction(),
  );
}

export function recordOath(authority: PublicKey, success: boolean) {
  return runWrite("record_oath", authority, { success }, () =>
    program.methods
      .recordOath(success)
      .accountsPartial({ keeper: keeperPda(authority), authority })
      .instruction(),
  );
}

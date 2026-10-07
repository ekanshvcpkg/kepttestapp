// Every tunable value in the app, in ONE place. (The level/rank curve lives in
// progress/curve.ts by design; on-chain numbers live in program/.../constants.rs.)

/** Quest slots per Keeper (must match QUEST_SLOTS in constants.rs). */
export const QUEST_SLOTS = 8;

/** Tier names in on-chain enum order (must match `Tier` in state.rs). */
export const TIERS = ["easy", "normal", "hard", "epic"] as const;
export type TierName = (typeof TIERS)[number];

/** Base XP per tier, display only; the program decides the real award. */
export const TIER_XP_LABEL: Record<TierName, number> = { easy: 50, normal: 100, hard: 150, epic: 250 };

/** Daily XP cap, display only (must match DAILY_XP_CAP in constants.rs). */
export const DAILY_XP_CAP_LABEL = 600;

/** Length of the stand-in proof hash. */
export const PROOF_HASH_BYTES = 32;

/** Debug log ring buffer size and its AsyncStorage key. */
export const LOG_CAPACITY = 500;
export const LOG_STORAGE_KEY = "kept-test/debug-log/v1";
/** Debounce for persisting the log, ms. */
export const LOG_PERSIST_DEBOUNCE_MS = 300;

/** AsyncStorage key for the remembered wallet session (auth token + address). */
export const WALLET_AUTH_STORAGE_KEY = "kept-test/wallet-session/v1";
export const BACKEND_SESSION_STORAGE_KEY = "kept-v4/backend-session/v1";

/** How long to wait for the app to return to the foreground after the wallet, ms. */
export const FOREGROUND_WAIT_TIMEOUT_MS = 60_000;

/** Default Soul amount in the Buy Soul field. */
export const DEFAULT_BUY_SOUL_AMOUNT = "100";

/** i64::MIN as a string: the on-chain "never" day sentinel. */
export const NEVER_DAY = "-9223372036854775808";

export const LAMPORTS_PER_SOL = 1_000_000_000;

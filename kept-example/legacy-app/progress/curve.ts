// THE ONLY copy of the level / rank curve. Nothing on chain stores Level or Rank: both are
// pure functions of the Keeper's on-chain `xp_total`. Retune here, and only here.
//
//   XP to go from level n to n+1      = 100 + 50 * (n - 1)
//   Cumulative XP to BE level n       = 25 * (n - 1) * (n + 2)
//
//   level 1 → 0 · 2 → 100 · 10 → 2,700 · 20 → 10,450 · 35 → 31,450 · 55 → 76,950

export const LEVEL_BASE_STEP_XP = 100;
export const LEVEL_STEP_GROWTH_XP = 50;

export type Rank = "E" | "D" | "C" | "B" | "A" | "S";

/** Minimum level for each rank, highest first. */
export const RANK_FLOORS: ReadonlyArray<readonly [Rank, number]> = [
  ["S", 55],
  ["A", 35],
  ["B", 20],
  ["C", 10],
  ["D", 5],
  ["E", 1],
];

/** XP needed to go from level n to n + 1. */
export function xpForLevelStep(n: number): number {
  return LEVEL_BASE_STEP_XP + LEVEL_STEP_GROWTH_XP * (n - 1);
}

/** Total XP needed to BE level n (n >= 1). Sum of every step below n. */
export function xpToReachLevel(n: number): number {
  // Closed form of sum_{k=1}^{n-1} (100 + 50(k-1)) = 25(n-1)(n+2) for the default numbers.
  const steps = n - 1;
  return steps * LEVEL_BASE_STEP_XP + (LEVEL_STEP_GROWTH_XP * steps * (steps - 1)) / 2;
}

/** The largest n with xpToReachLevel(n) <= xp. */
export function levelFromXp(xp: number | bigint): number {
  const total = Math.max(0, Number(xp));
  // Grow by doubling, then binary search: exact integer math, no float sqrt rounding.
  let hi = 2;
  while (xpToReachLevel(hi) <= total) hi *= 2;
  let lo = Math.max(1, hi / 2);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (xpToReachLevel(mid) <= total) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function rankFromLevel(n: number): Rank {
  for (const [rank, floor] of RANK_FLOORS) if (n >= floor) return rank;
  return "E";
}

/** XP earned inside the current level (progress bar numerator). */
export function xpIntoLevel(xp: number | bigint): number {
  return Math.max(0, Number(xp)) - xpToReachLevel(levelFromXp(xp));
}

/** XP the current level's step costs (progress bar denominator). */
export function xpForNextLevel(xp: number | bigint): number {
  return xpForLevelStep(levelFromXp(xp));
}

export type Derived = {
  level: number;
  rank: Rank;
  xpIntoLevel: number;
  xpForNextLevel: number;
};

export function derive(xpTotal: number | bigint): Derived {
  const level = levelFromXp(xpTotal);
  return {
    level,
    rank: rankFromLevel(level),
    xpIntoLevel: xpIntoLevel(xpTotal),
    xpForNextLevel: xpForNextLevel(xpTotal),
  };
}

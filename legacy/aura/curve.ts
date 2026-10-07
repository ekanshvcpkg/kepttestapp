// Level from XP. Level is never stored on chain: it is a pure function of the Keeper's
// `xp_total`. This MUST match the app's curve (kept-example/app/src/progress/curve.ts):
//   XP to be level n = 25 * (n - 1) * (n + 2)     (level 2 = 100, level 10 = 2,700)

export const xpToReachLevel = (n: number): number => 25 * (n - 1) * (n + 2);

/** The largest n with xpToReachLevel(n) <= xp. */
export function levelFromXp(xp: number | bigint): number {
  const total = Math.max(0, Number(xp));
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

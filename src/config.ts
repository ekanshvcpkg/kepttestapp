export const config = {
  port: Number(process.env.PORT ?? 3000),
  devnetRpcUrl: process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
  // TODO: replace with the real Devnet treasury wallet address once generated.
  treasuryAddress: process.env.TREASURY_ADDRESS ?? "11111111111111111111111111111111",
};

// Server-side coin shop — the client never gets to say how much SOL a package
// costs or how many coins it's worth. Must match the packageId keys used by
// the app (testharness/MainActivity.kt's COIN_PACKAGES).
export const coinPackages: Record<string, { lamports: number; coins: number }> = {
  small: { lamports: 10_000_000, coins: 100 }, // 0.01 SOL -> 100 coins
  medium: { lamports: 45_000_000, coins: 500 }, // 0.045 SOL -> 500 coins (bonus rate)
  large: { lamports: 90_000_000, coins: 1200 }, // 0.09 SOL -> 1200 coins (bigger bonus)
};

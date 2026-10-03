export const config = {
  port: Number(process.env.PORT ?? 3000),
  devnetRpcUrl: process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
  // Public Devnet treasury address (safe to commit). Must match the app's TREASURY_ADDRESS.
  // `||` (not `??`) so an empty env var on the host also falls back to it.
  treasuryAddress: process.env.TREASURY_ADDRESS || "4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR",
  // The deployed `kept_test` Anchor program (Devnet) that stores Keeper XP / Soul. Aura watches it.
  keeperProgramId: process.env.KEEPER_PROGRAM_ID || "6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh",
  // --- Aura (compressed NFT) minting. All optional: unset = Aura endpoints answer 503. ---
  // Merkle tree created by `npm run aura:setup`.
  auraMerkleTree: process.env.AURA_MERKLE_TREE || "",
  // The minter wallet's secret key as a JSON array (the contents of .aura-minter.json).
  // SECRET: Devnet only, set in the host's environment, never commit it.
  auraMinterSecretKey: process.env.AURA_MINTER_SECRET_KEY || "",
  // Shared secret Helius sends in the Authorization header of every webhook call.
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  // Public base URL, used in NFT metadata. Render provides RENDER_EXTERNAL_URL itself.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, ""),
};

// Server-side coin shop — the client never gets to say how much SOL a package
// costs or how many coins it's worth. Must match the packageId keys used by
// the app (testharness/MainActivity.kt's COIN_PACKAGES).
export const coinPackages: Record<string, { lamports: number; coins: number }> = {
  small: { lamports: 10_000_000, coins: 100 }, // 0.01 SOL -> 100 coins
  medium: { lamports: 45_000_000, coins: 500 }, // 0.045 SOL -> 500 coins (bonus rate)
  large: { lamports: 90_000_000, coins: 1200 }, // 0.09 SOL -> 1200 coins (bigger bonus)
};

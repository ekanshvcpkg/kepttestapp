import { timingSafeEqual } from "node:crypto";
import { Router, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";

import { config } from "../config.js";
import { MILESTONES, milestoneById, milestoneSvg, AURA_SYMBOL, AURA_SELLER_FEE_BPS } from "../aura/milestones.js";
import { auraConfigured, createBubblegumMinter } from "../aura/minter.js";
import { ProcessDeps, signaturesFromWebhook, syncSignature, syncWallet } from "../aura/process.js";
import { prismaAuraStore } from "../aura/store.js";

export const auraRouter = Router();

let deps: ProcessDeps | null = null;
function getDeps(): ProcessDeps | null {
  if (!auraConfigured()) return null;
  deps ??= { store: prismaAuraStore, minter: createBubblegumMinter() };
  return deps;
}

function secretMatches(header: string | undefined): boolean {
  if (!config.webhookSecret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(config.webhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const NOT_CONFIGURED = {
  error: "Aura minting is not configured (AURA_MERKLE_TREE, AURA_MINTER_SECRET_KEY, PUBLIC_BASE_URL)",
};

// Helius webhook: POST of an array of transactions touching the program. Nothing in the body
// is trusted; each signature is re-fetched and re-verified on chain.
auraRouter.post("/webhooks/helius", (req: Request, res: Response) => {
  if (!secretMatches(req.header("authorization"))) return res.status(401).json({ error: "Unauthorized" });
  const d = getDeps();
  if (!d) return res.status(503).json(NOT_CONFIGURED);

  const signatures = signaturesFromWebhook(req.body);
  // Answer right away so Helius does not time out and retry while we mint. Failed mints are
  // recorded as FAILED and retried by the next event or POST /api/aura/sync/:wallet.
  res.status(200).json({ accepted: signatures.length });
  void (async () => {
    for (const signature of signatures) {
      try {
        const results = await syncSignature(d, signature);
        for (const r of results) console.log(`[aura] ${signature} -> ${r.wallet} level ${r.level}`, JSON.stringify(r.outcomes));
      } catch (e) {
        console.error(`[aura] ${signature} failed:`, e instanceof Error ? e.message : e);
      }
    }
  })();
});

// Manual / catch-up sync for one wallet. Idempotent and trustless: it only reads the chain.
auraRouter.post("/api/aura/sync/:wallet", async (req, res) => {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(req.params.wallet);
  } catch {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  const d = getDeps();
  if (!d) return res.status(503).json(NOT_CONFIGURED);
  try {
    const result = await syncWallet(d, wallet);
    if (!result) return res.status(404).json({ error: "No Keeper for this wallet" });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "sync failed" });
  }
});

// The Auras a wallet has been given (or is being given).
auraRouter.get("/api/aura/:wallet", async (req, res) => {
  try {
    const rows = await prismaAuraStore.list(req.params.wallet);
    return res.status(200).json({
      wallet: req.params.wallet,
      auras: rows.map((r) => ({
        milestoneId: r.milestoneId,
        level: r.levelAtMint,
        status: r.status,
        assetId: r.assetId,
        mintSignature: r.mintSignature,
        error: r.error,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : "read failed" });
  }
});

// NFT metadata + placeholder art, served by this backend (no external hosting needed).
auraRouter.get("/aura/metadata/:id.json", (req, res) => {
  const m = milestoneById(req.params.id);
  if (!m) return res.status(404).json({ error: "Unknown milestone" });
  return res.status(200).json({
    name: m.name,
    symbol: AURA_SYMBOL,
    description: `Awarded by KEPT for reaching level ${m.level}.`,
    image: `${config.publicBaseUrl}/aura/image/${m.id}.svg`,
    seller_fee_basis_points: AURA_SELLER_FEE_BPS,
    attributes: [
      { trait_type: "Milestone", value: m.id },
      { trait_type: "Level", value: m.level },
    ],
    properties: { files: [{ uri: `${config.publicBaseUrl}/aura/image/${m.id}.svg`, type: "image/svg+xml" }], category: "image" },
  });
});

auraRouter.get("/aura/image/:id.svg", (req, res) => {
  const m = milestoneById(req.params.id);
  if (!m) return res.status(404).end();
  return res.type("image/svg+xml").send(milestoneSvg(m));
});

export const AURA_MILESTONE_COUNT = MILESTONES.length;

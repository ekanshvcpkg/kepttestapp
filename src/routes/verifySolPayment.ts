import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config, coinPackages } from "../config.js";
import { verifyTransactionOnChain } from "../solana.js";

export const verifySolPaymentRouter = Router();

// Base58, no 0/O/I/l. Solana signatures are typically 87-88 chars; allow some slack.
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

verifySolPaymentRouter.post("/api/verify-sol-payment", async (req, res) => {
  const { signature, packageId } = req.body ?? {};

  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) {
    return res.status(400).json({ error: "Invalid signature" });
  }
  if (typeof packageId !== "string" || !(packageId in coinPackages)) {
    return res.status(400).json({ error: "Unknown packageId" });
  }

  // Idempotency fast path: already verified + credited, so a retry succeeds
  // without re-processing (the unique constraint below is the real guarantee).
  const existing = await prisma.payment.findUnique({ where: { signature } });
  if (existing) {
    const user = await prisma.user.findUnique({ where: { walletAddress: existing.payerAddress } });
    return res.status(200).json({
      success: true,
      payerAddress: existing.payerAddress,
      packageId: existing.packageId,
      lamports: Number(existing.lamports),
      coinsAwarded: existing.coinsAwarded,
      coinBalance: user?.coinBalance ?? 0,
      idempotent: true,
    });
  }

  const pkg = coinPackages[packageId];
  const result = await verifyTransactionOnChain(signature, pkg.lamports);

  if (!result.ok) {
    return res.status(result.status).json({ error: result.reason });
  }

  try {
    // Payment insert + coin credit happen atomically: a coin is never
    // credited without a recorded, verified, one-time-use payment behind it.
    const user = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          signature,
          payerAddress: result.payerAddress,
          packageId,
          lamports: result.lamports,
          coinsAwarded: pkg.coins,
          treasuryAddress: config.treasuryAddress,
        },
      });

      return tx.user.upsert({
        where: { walletAddress: result.payerAddress },
        create: { walletAddress: result.payerAddress, coinBalance: pkg.coins },
        update: { coinBalance: { increment: pkg.coins } },
      });
    });

    return res.status(200).json({
      success: true,
      payerAddress: result.payerAddress,
      packageId,
      lamports: result.lamports,
      coinsAwarded: pkg.coins,
      coinBalance: user.coinBalance,
    });
  } catch (e) {
    // Unique constraint race: another request already inserted this signature
    // (and credited the coins) between our lookup and this transaction.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.payment.findUniqueOrThrow({ where: { signature } });
      const user = await prisma.user.findUnique({ where: { walletAddress: row.payerAddress } });
      return res.status(200).json({
        success: true,
        payerAddress: row.payerAddress,
        packageId: row.packageId,
        lamports: Number(row.lamports),
        coinsAwarded: row.coinsAwarded,
        coinBalance: user?.coinBalance ?? 0,
        idempotent: true,
      });
    }
    throw e;
  }
});

verifySolPaymentRouter.get("/api/balance/:address", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { walletAddress: req.params.address } });
  return res.status(200).json({ address: req.params.address, coinBalance: user?.coinBalance ?? 0 });
});

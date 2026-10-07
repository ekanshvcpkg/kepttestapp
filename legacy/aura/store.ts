import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import { Milestone } from "./milestones.js";
import { AuraRecord, AuraStatus, AuraStore } from "./service.js";

const toRecord = (r: {
  id: number; walletAddress: string; milestoneId: string; levelAtMint: number; status: string;
  assetId: string | null; mintSignature: string | null; error: string | null;
}): AuraRecord => ({ ...r, status: r.status as AuraStatus });

export const prismaAuraStore: AuraStore = {
  async list(wallet) {
    const rows = await prisma.auraMint.findMany({ where: { walletAddress: wallet }, orderBy: { id: "asc" } });
    return rows.map(toRecord);
  },

  async claim(wallet, milestone: Milestone, level) {
    try {
      const row = await prisma.auraMint.create({
        data: { walletAddress: wallet, milestoneId: milestone.id, levelAtMint: level, status: "MINTING" },
      });
      return toRecord(row);
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
    // Row exists: only a FAILED one may be retried, and only by one caller (atomic flip).
    const flipped = await prisma.auraMint.updateMany({
      where: { walletAddress: wallet, milestoneId: milestone.id, status: "FAILED" },
      data: { status: "MINTING", error: null },
    });
    if (flipped.count !== 1) return null;
    const row = await prisma.auraMint.findUniqueOrThrow({
      where: { walletAddress_milestoneId: { walletAddress: wallet, milestoneId: milestone.id } },
    });
    return toRecord(row);
  },

  async markMinted(id, assetId, signature) {
    await prisma.auraMint.update({ where: { id }, data: { status: "MINTED", assetId, mintSignature: signature, error: null } });
  },

  async markFailed(id, error) {
    await prisma.auraMint.update({ where: { id }, data: { status: "FAILED", error: error.slice(0, 2000) } });
  },
};

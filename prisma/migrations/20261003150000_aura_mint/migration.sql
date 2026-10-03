-- CreateTable
CREATE TABLE "AuraMint" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "levelAtMint" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT,
    "mintSignature" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuraMint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuraMint_walletAddress_milestoneId_key" ON "AuraMint"("walletAddress", "milestoneId");


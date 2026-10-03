-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "signature" TEXT NOT NULL,
    "payerAddress" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "coinsAwarded" INTEGER NOT NULL,
    "treasuryAddress" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "coinBalance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_signature_key" ON "Payment"("signature");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

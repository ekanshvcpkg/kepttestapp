CREATE TABLE "SessionSeat" (
  "id" SERIAL NOT NULL,
  "wallet" TEXT NOT NULL,
  "genesisMint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionSeat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionSeat_wallet_key" ON "SessionSeat"("wallet");
CREATE UNIQUE INDEX "SessionSeat_genesisMint_key" ON "SessionSeat"("genesisMint");

CREATE TABLE "OathInvite" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "oath" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OathInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OathInvite_code_key" ON "OathInvite"("code");

CREATE TABLE "OathProof" (
  "id" SERIAL NOT NULL,
  "oath" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "dayIndex" INTEGER NOT NULL,
  "proofHash" TEXT NOT NULL,
  "photoPath" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "objectLabel" TEXT NOT NULL,
  "objectConfidence" DOUBLE PRECISION NOT NULL,
  "gestureLabel" TEXT NOT NULL,
  "gestureConfidence" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OathProof_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OathProof_oath_wallet_dayIndex_key" ON "OathProof"("oath", "wallet", "dayIndex");
CREATE INDEX "OathProof_oath_dayIndex_idx" ON "OathProof"("oath", "dayIndex");

CREATE TABLE "DeviceToken" (
  "id" SERIAL NOT NULL,
  "wallet" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX "DeviceToken_wallet_idx" ON "DeviceToken"("wallet");

CREATE TABLE "Nudge" (
  "id" SERIAL NOT NULL,
  "oath" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "dayIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Nudge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Nudge_oath_sender_recipient_dayIndex_key" ON "Nudge"("oath", "sender", "recipient", "dayIndex");

CREATE TABLE "OathWatch" (
  "id" SERIAL NOT NULL,
  "oath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OathWatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OathWatch_oath_key" ON "OathWatch"("oath");
CREATE TABLE "ReminderSent" (
  "id" SERIAL NOT NULL,
  "oath" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "dayIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReminderSent_oath_wallet_dayIndex_key" ON "ReminderSent"("oath", "wallet", "dayIndex");
CREATE TABLE "FaucetClaim" (
  "id" SERIAL NOT NULL,
  "wallet" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FaucetClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FaucetClaim_wallet_key" ON "FaucetClaim"("wallet");

CREATE TABLE "OathDetails" (
  "id" SERIAL NOT NULL,
  "oath" TEXT NOT NULL,
  "creator" TEXT NOT NULL,
  "goalText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OathDetails_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OathDetails_oath_key" ON "OathDetails"("oath");

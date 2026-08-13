CREATE TYPE "TradePlanStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "TradePlan" (
  "id" UUID NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "previewHash" TEXT NOT NULL,
  "confirmationMessage" TEXT NOT NULL,
  "status" "TradePlanStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "receipt" JSONB,
  "executedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradePlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradePlan_walletAddress_status_idx" ON "TradePlan"("walletAddress", "status");
CREATE INDEX "TradePlan_status_expiresAt_idx" ON "TradePlan"("status", "expiresAt");

ALTER TABLE "TradePlan"
  ADD CONSTRAINT "TradePlan_walletAddress_fkey"
  FOREIGN KEY ("walletAddress") REFERENCES "Player"("walletAddress")
  ON DELETE CASCADE ON UPDATE CASCADE;

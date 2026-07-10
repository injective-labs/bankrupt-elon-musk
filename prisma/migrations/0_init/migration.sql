-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Player" (
    "walletAddress" TEXT NOT NULL,
    "walletName" TEXT,
    "cash" DOUBLE PRECISION NOT NULL,
    "debt" DOUBLE PRECISION NOT NULL,
    "accruedInterest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastInterestAccruedAt" DOUBLE PRECISION NOT NULL,
    "liquidated" BOOLEAN NOT NULL DEFAULT false,
    "leverage" INTEGER NOT NULL DEFAULT 1,
    "netWorth" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION NOT NULL,
    "holdingsValue" DOUBLE PRECISION NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh',
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "sort" TEXT NOT NULL DEFAULT 'featured',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "costBasis" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeLog" (
    "id" BIGSERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "ts" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "walletAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateIndex
CREATE INDEX "Player_pnl_idx" ON "Player"("pnl");

-- CreateIndex
CREATE UNIQUE INDEX "Position_walletAddress_productId_key" ON "Position"("walletAddress", "productId");

-- CreateIndex
CREATE INDEX "TradeLog_walletAddress_ts_idx" ON "TradeLog"("walletAddress", "ts");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Player"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeLog" ADD CONSTRAINT "TradeLog_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Player"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;


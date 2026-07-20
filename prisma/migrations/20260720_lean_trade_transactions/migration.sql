ALTER TABLE "Transaction"
  ALTER COLUMN "commandSnapshot" DROP NOT NULL,
  ALTER COLUMN "resultSnapshot" DROP NOT NULL,
  ADD COLUMN "requestedQuantity" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

CREATE INDEX "Transaction_walletAddress_id_idx"
  ON "Transaction"("walletAddress", "id");

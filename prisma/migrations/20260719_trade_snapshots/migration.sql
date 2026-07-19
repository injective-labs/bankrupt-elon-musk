ALTER TABLE "Transaction"
  ADD COLUMN "commandSnapshot" JSONB,
  ADD COLUMN "resultSnapshot" JSONB;

UPDATE "Transaction"
SET
  "commandSnapshot" = '{"legacy":true,"reason":"pre_snapshot_transaction"}'::jsonb,
  "resultSnapshot" = '{"legacy":true,"reason":"pre_snapshot_transaction"}'::jsonb
WHERE "commandSnapshot" IS NULL OR "resultSnapshot" IS NULL;

ALTER TABLE "Transaction"
  ALTER COLUMN "commandSnapshot" SET NOT NULL,
  ALTER COLUMN "resultSnapshot" SET NOT NULL;

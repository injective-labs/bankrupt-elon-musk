import { PrismaClient } from "@prisma/client";

import { buildAssetSeed } from "../src/data/assetSeed";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = buildAssetSeed();

  await prisma.$transaction(
    rows.map((row) =>
      prisma.asset.upsert({
        where: { id: row.id },
        create: row,
        update: {
          ticker: row.ticker,
          quoteSymbol: row.quoteSymbol,
          nameZh: row.nameZh,
          nameEn: row.nameEn,
          assetClass: row.assetClass,
          subCategory: row.subCategory,
          currency: row.currency,
          unit: row.unit,
          quoteMultiplier: row.quoteMultiplier,
          enabled: row.enabled,
          displayOrder: row.displayOrder,
        },
      }),
    ),
  );
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

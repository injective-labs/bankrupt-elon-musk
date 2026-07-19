import { Prisma } from "@prisma/client";

export function decimalToString(
  value: Prisma.Decimal | string | number,
): string {
  return new Prisma.Decimal(value).toString();
}

export function parsePositiveIntegerQuantity(value: unknown): Prisma.Decimal {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Quantity must be a positive integer");
  }

  const quantity = new Prisma.Decimal(value);
  if (!quantity.greaterThan(0) || !quantity.isInteger()) {
    throw new Error("Quantity must be a positive integer");
  }

  return quantity;
}

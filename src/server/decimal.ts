import { Prisma } from "@prisma/client";

export function decimalToString(
  value: Prisma.Decimal | string | number,
): string {
  const normalized = typeof value === "object" ? value.toString() : value;
  return new Prisma.Decimal(normalized).toFixed();
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

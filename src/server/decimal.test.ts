import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { decimalToString, parsePositiveIntegerQuantity } from "@/server/decimal";

describe("decimal boundaries", () => {
  it("serializes a Decimal without insignificant trailing zeroes", () => {
    expect(decimalToString(new Prisma.Decimal("50000000000.00000000"))).toBe(
      "50000000000",
    );
  });

  it("serializes tiny decimals without exponent notation", () => {
    expect(decimalToString(new Prisma.Decimal("0.000000009"))).toBe("0.000000009");
  });

  it("parses a positive integer quantity", () => {
    expect(parsePositiveIntegerQuantity("12").toString()).toBe("12");
  });

  it("rejects a fractional quantity", () => {
    expect(() => parsePositiveIntegerQuantity("1.5")).toThrow("positive integer");
  });

  it("rejects zero", () => {
    expect(() => parsePositiveIntegerQuantity("0")).toThrow("positive integer");
  });

  it("rejects exponent notation", () => {
    expect(() => parsePositiveIntegerQuantity("1e3")).toThrow("positive integer");
  });
});

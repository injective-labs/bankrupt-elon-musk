import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { playerUpsert } = vi.hoisted(() => ({ playerUpsert: vi.fn() }));

vi.mock("./db", () => ({
  prisma: { player: { upsert: playerUpsert } },
}));

import { loginPlayer } from "./account";

describe("loginPlayer", () => {
  beforeEach(() => playerUpsert.mockReset());

  it("funds the player only through the atomic create branch", async () => {
    const wallet = "0x0000000000000000000000000000000000000001";
    const current = {
      walletAddress: wallet,
      walletName: null,
      cash: new Prisma.Decimal("50000000000"),
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    playerUpsert.mockResolvedValue(current);

    await loginPlayer(wallet);
    await loginPlayer(wallet);

    expect(playerUpsert).toHaveBeenCalledTimes(2);
    for (const call of playerUpsert.mock.calls) {
      expect(call[0].create.cash.toString()).toBe("50000000000");
      expect(call[0].update).not.toHaveProperty("cash");
    }
    expect(current.cash.toString()).toBe("50000000000");
  });

  it("updates wallet metadata and lastLoginAt on returning login without cash", async () => {
    const wallet = "0x0000000000000000000000000000000000000001";
    playerUpsert.mockResolvedValue({ walletAddress: wallet });

    await loginPlayer(wallet, "alice.inj");

    const operation = playerUpsert.mock.calls[0][0];
    expect(operation.where).toEqual({ walletAddress: wallet });
    expect(operation.update.walletName).toBe("alice.inj");
    expect(operation.update.lastLoginAt).toBeInstanceOf(Date);
    expect(operation.update).not.toHaveProperty("cash");
  });
});

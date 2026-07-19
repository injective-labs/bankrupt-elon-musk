import { Prisma } from "@prisma/client";
import { SignJWT } from "jose";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createNonce } from "@/../app/api/auth/nonce/route";
import { POST as verifyWallet } from "@/../app/api/auth/verify/route";
import { GET as getGame } from "@/../app/api/game/route";
import { POST as resetGame } from "@/../app/api/game/reset/route";
import { GET as getLeaderboard } from "@/../app/api/leaderboard/route";
import { GET as getHistory, POST as trade } from "@/../app/api/trades/route";
import { prisma } from "@/server/db";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const otherWallet = "0x0000000000000000000000000000000000000011";
const assetId = "bitcoin-coin";
const tradeKey = "00000000-0000-4000-8000-000000000111";
const failedTradeKey = "00000000-0000-4000-8000-000000000112";
const resetKey = "00000000-0000-4000-8000-000000000113";

async function cookieFor(walletAddress: string): Promise<string> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(walletAddress)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return `musk_session=${token}`;
}

function authenticated(url: string, cookie: string, init?: RequestInit): Request {
  return new Request(url, { ...init, headers: { ...init?.headers, cookie } });
}

describeDatabase("migrated authenticated game flow (PostgreSQL)", () => {
  let cookie: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "task-11-disposable-integration-secret";
    process.env.ENABLE_GAME_RESET = "true";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T14:00:00Z"));
    cookie = await cookieFor(account.address);
  });

  beforeEach(async () => {
    await prisma.player.deleteMany({
      where: { walletAddress: { in: [account.address, otherWallet] } },
    });
    await prisma.assetQuote.upsert({
      where: { assetId },
      create: {
        assetId,
        nativePrice: new Prisma.Decimal(100),
        currency: "USD",
        fxRateToUsd: new Prisma.Decimal(1),
        usdPrice: new Prisma.Decimal(100),
        marketDate: new Date("2026-07-20T00:00:00Z"),
        source: "integration test",
        status: "ACTIVE",
        fetchedAt: new Date(),
      },
      update: {
        nativePrice: new Prisma.Decimal(100),
        currency: "USD",
        fxRateToUsd: new Prisma.Decimal(1),
        usdPrice: new Prisma.Decimal(100),
        marketDate: new Date("2026-07-20T00:00:00Z"),
        source: "integration test",
        status: "ACTIVE",
        fetchedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "task11_fail_transaction" ON "Transaction"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS task11_fail_transaction()');
    await prisma.player.deleteMany({ where: { walletAddress: { in: [account.address, otherWallet] } } });
    await prisma.assetQuote.deleteMany({ where: { assetId } });
    vi.useRealTimers();
    await prisma.$disconnect();
  });

  it("has every migration applied and seeds exactly 160 assets", async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    expect(migrations.map((row) => row.migration_name)).toEqual(expect.arrayContaining([
      "0_init",
      "20260719_server_authoritative_game",
      "20260719_trade_snapshots",
    ]));
    expect(await prisma.asset.count()).toBe(160);
  });

  it("funds the first wallet login once and preserves changed cash on the second login", async () => {
    const nonceResponse = await createNonce(new Request("http://localhost/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ address: account.address }),
    }));
    const nonce = await nonceResponse.json() as { message: string };
    const signature = await account.signMessage({ message: nonce.message });
    const login = () => verifyWallet(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address: account.address, signature, walletName: "task11.inj" }),
    }));

    expect((await login()).status).toBe(200);
    expect((await prisma.player.findUniqueOrThrow({ where: { walletAddress: account.address } })).cash.toString()).toBe("50000000000");

    await prisma.player.update({ where: { walletAddress: account.address }, data: { cash: new Prisma.Decimal("49999999900") } });
    const secondNonceResponse = await createNonce(new Request("http://localhost/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ address: account.address }),
    }));
    const secondNonce = await secondNonceResponse.json() as { message: string };
    const secondSignature = await account.signMessage({ message: secondNonce.message });
    const secondLogin = await verifyWallet(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address: account.address, signature: secondSignature }),
    }));

    expect(secondLogin.status).toBe(200);
    expect((await prisma.player.findUniqueOrThrow({ where: { walletAddress: account.address } })).cash.toString()).toBe("49999999900");
  });

  it("atomically commits Player, Position, and Transaction and reloads the database projection", async () => {
    await prisma.player.create({ data: { walletAddress: account.address, cash: new Prisma.Decimal("50000000000"), lastLoginAt: new Date() } });
    const response = await trade(authenticated("http://localhost/api/trades", cookie, {
      method: "POST",
      body: JSON.stringify({ assetId, side: "BUY", quantity: "2", idempotencyKey: tradeKey }),
    }));
    expect(response.status).toBe(200);
    const committed = await response.json();

    const [player, position, transaction] = await Promise.all([
      prisma.player.findUniqueOrThrow({ where: { walletAddress: account.address } }),
      prisma.position.findUniqueOrThrow({ where: { walletAddress_assetId: { walletAddress: account.address, assetId } } }),
      prisma.transaction.findUniqueOrThrow({ where: { walletAddress_idempotencyKey: { walletAddress: account.address, idempotencyKey: tradeKey } } }),
    ]);
    expect(player.cash.toString()).toBe("49999999800");
    expect(position.quantity.toString()).toBe("2");
    expect(transaction.cashAfter.toString()).toBe("49999999800");

    const reload = await getGame(authenticated("http://localhost/api/game", cookie));
    expect(reload.status).toBe(200);
    expect(await reload.json()).toEqual(committed);
  });

  it("rolls back player and position changes when the transaction ledger insert fails", async () => {
    await prisma.player.create({ data: { walletAddress: account.address, cash: new Prisma.Decimal("50000000000"), lastLoginAt: new Date() } });
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION task11_fail_transaction() RETURNS trigger AS $$
      BEGIN
        IF NEW."idempotencyKey" = '${failedTradeKey}' THEN RAISE EXCEPTION 'task11 simulated failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "task11_fail_transaction" BEFORE INSERT ON "Transaction"
      FOR EACH ROW EXECUTE FUNCTION task11_fail_transaction()
    `);

    const response = await trade(authenticated("http://localhost/api/trades", cookie, {
      method: "POST",
      body: JSON.stringify({ assetId, side: "BUY", quantity: "2", idempotencyKey: failedTradeKey }),
    }));
    expect(response.status).toBe(500);
    expect((await prisma.player.findUniqueOrThrow({ where: { walletAddress: account.address } })).cash.toString()).toBe("50000000000");
    expect(await prisma.position.count({ where: { walletAddress: account.address } })).toBe(0);
    expect(await prisma.transaction.count({ where: { walletAddress: account.address } })).toBe(0);

    await prisma.$executeRawUnsafe('DROP TRIGGER "task11_fail_transaction" ON "Transaction"');
    await prisma.$executeRawUnsafe('DROP FUNCTION task11_fail_transaction()');
  });

  it("reset preserves the prior ledger rows and exposes them through history", async () => {
    await prisma.player.create({ data: { walletAddress: account.address, cash: new Prisma.Decimal("50000000000"), lastLoginAt: new Date() } });
    await trade(authenticated("http://localhost/api/trades", cookie, {
      method: "POST",
      body: JSON.stringify({ assetId, side: "BUY", quantity: "2", idempotencyKey: tradeKey }),
    }));
    const reset = await resetGame(authenticated("http://localhost/api/game/reset", cookie, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: resetKey }),
    }));
    expect(reset.status).toBe(200);
    expect(await prisma.transaction.count({ where: { walletAddress: account.address } })).toBe(2);
    expect(await prisma.position.count({ where: { walletAddress: account.address } })).toBe(0);

    const history = await getHistory(authenticated("http://localhost/api/trades", cookie));
    expect((await history.json()).rows.map((row: { type: string }) => row.type)).toEqual(["RESET", "BUY"]);
  });

  it("leaderboard computes P&L from server state and ignores attempted client P&L", async () => {
    await prisma.player.createMany({ data: [
      { walletAddress: account.address, walletName: "caller", cash: new Prisma.Decimal("49999999000"), lastLoginAt: new Date() },
      { walletAddress: otherWallet, walletName: "other", cash: new Prisma.Decimal("49999999900"), lastLoginAt: new Date() },
    ] });

    const response = await getLeaderboard(authenticated("http://localhost/api/leaderboard?pnl=999999999", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.top[0]).toMatchObject({ walletName: "caller", pnl: "-1000" });
    expect(body.you).toMatchObject({ rank: 1, pnl: "-1000" });
  });
});

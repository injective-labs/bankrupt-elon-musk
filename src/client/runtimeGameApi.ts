import { InjPassMiniAppConnector } from "@injpass/cli";
import { getAddress, isAddress } from "viem";

import * as http from "./gameApi";
import {
  GameApiError,
  type AgentSessionView,
  type MessageSigner,
  type SessionView,
  type TradeInput,
  type TransactionPage,
} from "./gameApi";
import type {
  AccountProjection,
  LeaderboardSnapshot,
  MarketProjection,
  TradeReceipt,
} from "@/types";

export interface RuntimeGameTransport {
  getSession(): Promise<SessionView | null>;
  loginWithSignature(address: string, walletName: string | null, signer: MessageSigner): Promise<SessionView>;
  logout(): Promise<void>;
  getAuthChallenge(address: string): Promise<{ nonce: string; message: string }>;
  verifyAgentSignature(address: string, walletName: string | null, signature: string): Promise<AgentSessionView>;
  getGame(authorizationToken?: string): Promise<AccountProjection>;
  getMarket(): Promise<MarketProjection>;
  submitTrade(command: TradeInput, authorizationToken?: string): Promise<TradeReceipt | AccountProjection>;
  resetGame(idempotencyKey: string, authorizationToken?: string): Promise<AccountProjection>;
  getTransactions(cursor?: string, limit?: number, authorizationToken?: string): Promise<TransactionPage>;
  getLeaderboard(authorizationToken?: string): Promise<LeaderboardSnapshot>;
}

export interface RuntimeGameApi {
  getSession(): Promise<SessionView | null>;
  loginWithSignature(address: string, walletName: string | null, signer: MessageSigner): Promise<SessionView>;
  logout(): Promise<void>;
  getGame(): Promise<AccountProjection>;
  getMarket(): Promise<MarketProjection>;
  submitTrade(command: TradeInput): Promise<TradeReceipt | AccountProjection>;
  resetGame(idempotencyKey: string): Promise<AccountProjection>;
  getTransactions(cursor?: string, limit?: number): Promise<TransactionPage>;
  getLeaderboard(): Promise<LeaderboardSnapshot>;
}

function gameAuthorizationExpired(): GameApiError {
  return new GameApiError(401, "GAME_AUTH_EXPIRED", "Game authorization expired");
}

function toHexSignature(signature: Uint8Array): `0x${string}` {
  return `0x${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createRuntimeGameApi({
  embedded,
  transport,
}: {
  embedded: () => boolean;
  transport: RuntimeGameTransport;
}): RuntimeGameApi {
  let agentSession: AgentSessionView | null = null;

  const embeddedRequest = async <T>(
    standaloneRequest: () => Promise<T>,
    authorizedRequest: (accessToken: string) => Promise<T>,
  ): Promise<T> => {
    if (!embedded()) return standaloneRequest();
    if (!agentSession) throw gameAuthorizationExpired();
    const requestSession = agentSession;
    try {
      return await authorizedRequest(requestSession.accessToken);
    } catch (error) {
      if (!(error instanceof GameApiError) || error.status !== 401) throw error;
      if (agentSession === requestSession) agentSession = null;
      throw gameAuthorizationExpired();
    }
  };

  return {
    getSession: async () => {
      if (!embedded()) return transport.getSession();
      return agentSession
        ? { walletAddress: agentSession.walletAddress, walletName: agentSession.walletName }
        : null;
    },
    loginWithSignature: async (address, walletName, signer) => {
      if (!embedded()) return transport.loginWithSignature(address, walletName, signer);
      agentSession = null;
      const { message } = await transport.getAuthChallenge(address);
      const signature = toHexSignature(await signer(message));
      const verified = await transport.verifyAgentSignature(address, walletName, signature);
      if (
        !isAddress(address)
        || !isAddress(verified.walletAddress)
        || getAddress(verified.walletAddress) !== getAddress(address)
      ) {
        throw new GameApiError(401, "GAME_AUTH_MISMATCH", "Game authorization wallet mismatch");
      }
      agentSession = verified;
      return { walletAddress: verified.walletAddress, walletName: verified.walletName };
    },
    logout: async () => {
      if (!embedded()) return transport.logout();
      agentSession = null;
    },
    getGame: () => embeddedRequest(
      () => transport.getGame(),
      (token) => transport.getGame(token),
    ),
    getMarket: () => transport.getMarket(),
    submitTrade: (command) => embeddedRequest(
      () => transport.submitTrade(command),
      (token) => transport.submitTrade(command, token),
    ),
    resetGame: (idempotencyKey) => embeddedRequest(
      () => transport.resetGame(idempotencyKey),
      (token) => transport.resetGame(idempotencyKey, token),
    ),
    getTransactions: (cursor, limit) => embeddedRequest(
      () => transport.getTransactions(cursor, limit),
      (token) => transport.getTransactions(cursor, limit, token),
    ),
    getLeaderboard: () => embeddedRequest(
      () => transport.getLeaderboard(),
      (token) => transport.getLeaderboard(token),
    ),
  };
}

const runtime = createRuntimeGameApi({
  embedded: () => InjPassMiniAppConnector.isEmbedded(),
  transport: http,
});

export const getSession = runtime.getSession;
export const loginWithSignature = runtime.loginWithSignature;
export const logout = runtime.logout;
export const getGame = runtime.getGame;
export const getMarket = runtime.getMarket;
export const submitTrade = runtime.submitTrade;
export const resetGame = runtime.resetGame;
export const getTransactions = runtime.getTransactions;
export const getLeaderboard = runtime.getLeaderboard;

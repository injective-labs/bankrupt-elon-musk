import type { InjPassMiniAppSession } from "@injpass/cli";
import { getAddress, isAddress, stringToHex } from "viem";

import {
  GameApiError,
  getAuthChallenge,
  getGame,
  getLeaderboard,
  getMarket,
  getTransactions,
  submitTrade,
  verifyAgentSignature,
  type TradeInput,
} from "@/client/gameApi";

interface AgentProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface ElonAgentApi {
  getMarket: typeof getMarket;
  getGame(session: InjPassMiniAppSession, signal?: AbortSignal): ReturnType<typeof getGame>;
  getTransactions(session: InjPassMiniAppSession, cursor?: string, limit?: number, signal?: AbortSignal): ReturnType<typeof getTransactions>;
  getLeaderboard(session: InjPassMiniAppSession, signal?: AbortSignal): ReturnType<typeof getLeaderboard>;
  submitTrade(session: InjPassMiniAppSession, command: TradeInput, signal?: AbortSignal): ReturnType<typeof submitTrade>;
  clearAgentSession(): void;
}

interface TokenBinding {
  walletAddress: string;
  accessToken: string;
  expiresAt: number;
}

function authenticatedWallet(session: InjPassMiniAppSession): string {
  if (!session.authenticated || !session.address || !isAddress(session.address)) {
    throw new GameApiError(401, "UNAUTHORIZED", "INJ Pass login required");
  }
  return getAddress(session.address);
}

export function createElonAgentApi(provider: AgentProvider): ElonAgentApi {
  let binding: TokenBinding | null = null;

  const clearAgentSession = () => {
    binding = null;
  };

  const bind = async (session: InjPassMiniAppSession, signal?: AbortSignal): Promise<TokenBinding> => {
    signal?.throwIfAborted();
    const walletAddress = authenticatedWallet(session);
    if (binding && binding.walletAddress === walletAddress && binding.expiresAt > Date.now() + 5_000) {
      return binding;
    }
    binding = null;
    const { message } = await getAuthChallenge(walletAddress, signal);
    signal?.throwIfAborted();
    const signature = await provider.request({
      method: "personal_sign",
      params: [stringToHex(message), walletAddress],
    });
    if (typeof signature !== "string") {
      throw new GameApiError(401, "UNAUTHORIZED", "Wallet returned an invalid signature");
    }
    signal?.throwIfAborted();
    const verified = await verifyAgentSignature(
      walletAddress,
      session.walletName ?? null,
      signature,
      signal,
    );
    signal?.throwIfAborted();
    if (!isAddress(verified.walletAddress) || getAddress(verified.walletAddress) !== walletAddress) {
      throw new GameApiError(401, "UNAUTHORIZED", "Agent session wallet mismatch");
    }
    binding = {
      walletAddress,
      accessToken: verified.accessToken,
      expiresAt: Date.now() + verified.expiresIn * 1_000,
    };
    return binding;
  };

  const protectedRequest = async <T>(
    session: InjPassMiniAppSession,
    request: (accessToken: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const first = await bind(session, signal);
    try {
      return await request(first.accessToken);
    } catch (error) {
      if (!(error instanceof GameApiError) || error.status !== 401) throw error;
      clearAgentSession();
      signal?.throwIfAborted();
      const rebound = await bind(session, signal);
      return request(rebound.accessToken);
    }
  };

  return {
    getMarket,
    getGame: (session, signal) => protectedRequest(session, (token) => getGame(token, signal), signal),
    getTransactions: (session, cursor, limit = 50, signal) => protectedRequest(
      session,
      (token) => getTransactions(cursor, Math.max(1, Math.min(Math.trunc(limit), 100)), token, signal),
      signal,
    ),
    getLeaderboard: (session, signal) => protectedRequest(session, (token) => getLeaderboard(token, signal), signal),
    submitTrade: (session, command, signal) => protectedRequest(session, (token) => submitTrade(command, token, signal), signal),
    clearAgentSession,
  };
}

"use client";

import type { InjPassMiniAppSession } from "@injpass/cli";
import { useEffect } from "react";

import { createElonAgentApi } from "./api";
import { executeElonAgentCommand } from "./execute";
import {
  destroyElonMiniAppConnector,
  getElonMiniAppConnector,
  trustedInjPassHostOrigin,
} from "./host";
import { ELON_AGENT_CHANNEL, parseElonAgentCommand, type ElonAgentResult } from "./protocol";

const COMMAND_TIMEOUT_MS = 60_000;
const COMPLETED_COMMAND_LIMIT = 100;

function withCommandTimeout(
  promise: Promise<ElonAgentResult>,
  onTimeout: () => void,
): Promise<ElonAgentResult> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(
      () => {
        onTimeout();
        resolve({ ok: false, key: "command_timeout" });
      },
      COMMAND_TIMEOUT_MS,
    );
    promise.then(
      (result) => {
        window.clearTimeout(timer);
        resolve(result);
      },
      () => {
        window.clearTimeout(timer);
        resolve({ ok: false, key: "unknown_error" });
      },
    );
  });
}

function sessionIdentity(session: InjPassMiniAppSession | null): string {
  return `${session?.authenticated === true ? "authenticated" : "anonymous"}:${session?.address?.toLowerCase() ?? ""}`;
}

export function InjPassAgentBridge() {
  useEffect(() => {
    const connector = getElonMiniAppConnector();
    if (!connector) return;

    const hostOrigin = trustedInjPassHostOrigin(
      window.location.href,
      process.env.NODE_ENV,
      process.env.NEXT_PUBLIC_INJPASS_EMBED_URL,
    );
    const api = createElonAgentApi(connector.getEthereumProvider());
    const activeCommands = new Map<string, AbortController>();
    const completedResults = new Map<string, ElonAgentResult>();
    const seenCommandIds = new Set<string>();
    let disposed = false;
    let currentSessionIdentity = sessionIdentity(connector.getSession());

    const post = (payload: Record<string, unknown>) => {
      window.parent.postMessage({ channel: ELON_AGENT_CHANNEL, ...payload }, hostOrigin);
    };

    const rememberResult = (id: string, result: ElonAgentResult) => {
      completedResults.set(id, result);
      if (completedResults.size > COMPLETED_COMMAND_LIMIT) {
        const oldest = completedResults.keys().next().value;
        if (oldest) completedResults.delete(oldest);
      }
    };

    const unsubscribeSession = connector.onSession((session) => {
      const nextIdentity = sessionIdentity(session);
      if (nextIdentity === currentSessionIdentity) return;
      currentSessionIdentity = nextIdentity;
      api.clearAgentSession();
      const sessionExpired = { ok: false, key: "session_expired" } satisfies ElonAgentResult;
      for (const id of completedResults.keys()) {
        completedResults.set(id, sessionExpired);
      }
      for (const [id, controller] of activeCommands) {
        controller.abort();
        activeCommands.delete(id);
        rememberResult(id, sessionExpired);
        post({
          type: "agent-command-result",
          id,
          result: sessionExpired,
        });
      }
    });

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== hostOrigin) return;
      const payload = event.data as Record<string, unknown> | null;
      if (
        !payload
        || payload.channel !== ELON_AGENT_CHANNEL
        || payload.type !== "agent-command"
        || typeof payload.id !== "string"
        || !payload.id
      ) return;
      const command = parseElonAgentCommand(payload.command);
      if (!command) return;

      const id = payload.id;
      const completed = completedResults.get(id);
      if (completed) {
        post({ type: "agent-command-result", id, result: completed });
        return;
      }
      if (activeCommands.has(id)) return;
      if (seenCommandIds.has(id)) {
        post({
          type: "agent-command-result",
          id,
          result: { ok: false, key: "duplicate_command" },
        });
        return;
      }

      const controller = new AbortController();
      seenCommandIds.add(id);
      activeCommands.set(id, controller);
      void withCommandTimeout(executeElonAgentCommand(command, {
        api,
        session: connector.getSession(),
        signal: controller.signal,
      }), () => controller.abort()).then((result) => {
        if (!disposed && activeCommands.delete(id)) {
          rememberResult(id, result);
          post({ type: "agent-command-result", id, result });
        }
      }).finally(() => {
        activeCommands.delete(id);
      });
    };

    window.addEventListener("message", handleMessage);
    return () => {
      disposed = true;
      for (const controller of activeCommands.values()) controller.abort();
      activeCommands.clear();
      completedResults.clear();
      seenCommandIds.clear();
      unsubscribeSession();
      window.removeEventListener("message", handleMessage);
      destroyElonMiniAppConnector();
    };
  }, []);

  return null;
}

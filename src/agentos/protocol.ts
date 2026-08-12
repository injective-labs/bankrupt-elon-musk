export const ELON_AGENT_CHANNEL = "injpass-miniapp-v1";

export type ElonAgentAction =
  | "open"
  | "market"
  | "balance"
  | "portfolio"
  | "history"
  | "rank"
  | "buy"
  | "sell";

export interface ElonAgentCommand {
  appId: "bankrupt-elon-musk";
  action: ElonAgentAction;
  rawText: string;
  language: string;
  params: {
    query?: string;
    asset?: string;
    quantity?: string;
    limit?: number;
  };
}

export interface ElonAgentResult {
  ok: boolean;
  key: string;
  data?: Record<string, unknown>;
  message?: string;
}

const ACTIONS = new Set<ElonAgentAction>([
  "open",
  "market",
  "balance",
  "portfolio",
  "history",
  "rank",
  "buy",
  "sell",
]);
const COMMAND_KEYS = new Set(["appId", "action", "rawText", "language", "params"]);
const PARAM_KEYS = new Set(["query", "asset", "quantity", "limit"]);
const QUANTITY_PATTERN = /^(?:MAX|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function parseElonAgentCommand(value: unknown): ElonAgentCommand | null {
  if (!isRecord(value) || !hasOnlyKeys(value, COMMAND_KEYS)) return null;
  if (value.appId !== "bankrupt-elon-musk") return null;
  if (typeof value.action !== "string" || !ACTIONS.has(value.action as ElonAgentAction)) return null;
  if (value.rawText !== undefined && typeof value.rawText !== "string") return null;
  if (value.language !== undefined && typeof value.language !== "string") return null;

  const params = value.params ?? {};
  if (!isRecord(params) || !hasOnlyKeys(params, PARAM_KEYS)) return null;
  if (params.query !== undefined && typeof params.query !== "string") return null;
  if (params.asset !== undefined && typeof params.asset !== "string") return null;
  if (
    params.quantity !== undefined
    && (typeof params.quantity !== "string" || !QUANTITY_PATTERN.test(params.quantity))
  ) return null;
  if (
    params.limit !== undefined
    && (typeof params.limit !== "number" || !Number.isFinite(params.limit))
  ) return null;

  return {
    appId: "bankrupt-elon-musk",
    action: value.action as ElonAgentAction,
    rawText: value.rawText ?? "",
    language: value.language ?? "en",
    params: {
      ...(params.query !== undefined ? { query: params.query } : {}),
      ...(params.asset !== undefined ? { asset: params.asset } : {}),
      ...(params.quantity !== undefined ? { quantity: params.quantity } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    },
  };
}

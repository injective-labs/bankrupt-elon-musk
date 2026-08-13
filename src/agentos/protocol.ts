export const ELON_AGENT_CHANNEL = "injpass-miniapp-v1";

export type ElonAgentAction =
  | "open"
  | "market"
  | "balance"
  | "portfolio"
  | "history"
  | "rank"
  | "buy"
  | "sell"
  | "prepare_trade"
  | "execute_trade_plan"
  | "cancel_trade_plan";

export type ElonTradePlanLeg =
  | { side: "BUY"; asset: string; quantity: string }
  | { side: "BUY"; asset: string; cashAmount: string }
  | { side: "BUY"; asset: string; cashBps: number }
  | { side: "SELL"; asset: string; quantity: string }
  | { side: "SELL"; asset: string; positionBps: number }
  | { side: "SELL"; category: string; positionBps: 10000 };

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
    legs?: ElonTradePlanLeg[];
    planId?: string;
    confirmationMessage?: string;
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
  "prepare_trade",
  "execute_trade_plan",
  "cancel_trade_plan",
]);
const COMMAND_KEYS = new Set(["appId", "action", "rawText", "language", "params"]);
const PARAM_KEYS = new Set(["query", "asset", "quantity", "limit", "legs", "planId", "confirmationMessage"]);
const QUANTITY_PATTERN = /^(?:MAX|[1-9]\d*)$/;
const LEG_KEYS = new Set(["side", "asset", "category", "quantity", "cashAmount", "cashBps", "positionBps"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parsePlanLeg(value: unknown): ElonTradePlanLeg | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LEG_KEYS) || (value.side !== "BUY" && value.side !== "SELL")) return null;
  const asset = typeof value.asset === "string" && value.asset.trim() ? value.asset.trim() : null;
  const category = typeof value.category === "string" && value.category.trim() ? value.category.trim() : null;
  const sizing = ["quantity", "cashAmount", "cashBps", "positionBps"].filter((key) => value[key] !== undefined);
  if (sizing.length !== 1) return null;
  if (typeof value.quantity === "string" && /^[1-9]\d*$/.test(value.quantity) && asset) {
    return value.side === "BUY"
      ? { side: "BUY", asset, quantity: value.quantity }
      : { side: "SELL", asset, quantity: value.quantity };
  }
  if (value.side === "BUY" && asset && typeof value.cashAmount === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value.cashAmount) && !/^0(?:\.0+)?$/.test(value.cashAmount)) {
    return { side: "BUY", asset, cashAmount: value.cashAmount };
  }
  if (value.side === "BUY" && asset && Number.isInteger(value.cashBps) && Number(value.cashBps) >= 1 && Number(value.cashBps) <= 10000) {
    return { side: "BUY", asset, cashBps: Number(value.cashBps) };
  }
  if (value.side === "SELL" && Number.isInteger(value.positionBps) && Number(value.positionBps) >= 1 && Number(value.positionBps) <= 10000) {
    if (asset && !category) return { side: "SELL", asset, positionBps: Number(value.positionBps) };
    if (category && !asset && value.positionBps === 10000) return { side: "SELL", category, positionBps: 10000 };
  }
  return null;
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

  let legs: ElonTradePlanLeg[] | undefined;
  if (value.action === "prepare_trade") {
    if (!Array.isArray(params.legs) || params.legs.length < 1 || params.legs.length > 20) return null;
    legs = params.legs.map(parsePlanLeg).filter((leg): leg is ElonTradePlanLeg => leg !== null);
    if (legs.length !== params.legs.length) return null;
    if (["query", "asset", "quantity", "limit", "planId", "confirmationMessage"].some((key) => params[key] !== undefined)) return null;
  } else if (params.legs !== undefined) return null;

  if (value.action === "execute_trade_plan") {
    if (typeof params.planId !== "string" || !params.planId || typeof params.confirmationMessage !== "string" || !params.confirmationMessage) return null;
    if (["query", "asset", "quantity", "limit"].some((key) => params[key] !== undefined)) return null;
  } else if (value.action === "cancel_trade_plan") {
    if (typeof params.planId !== "string" || !params.planId || params.confirmationMessage !== undefined) return null;
    if (["query", "asset", "quantity", "limit"].some((key) => params[key] !== undefined)) return null;
  } else if (params.planId !== undefined || params.confirmationMessage !== undefined) return null;
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
      ...(legs ? { legs } : {}),
      ...(params.planId !== undefined ? { planId: params.planId } : {}),
      ...(params.confirmationMessage !== undefined ? { confirmationMessage: params.confirmationMessage } : {}),
    },
  };
}

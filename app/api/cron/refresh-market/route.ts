import { refreshMarket } from "@/server/market/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await refreshMarket());
  } catch {
    return Response.json({ error: "Market refresh failed" }, { status: 500 });
  }
}

import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { quoteRequests } from "@/lib/business/quote-requests";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: RouteContext<"/api/quote-requests/[id]">) {
  return handle(request, quoteRequests, (await context.params).id);
}
export const PATCH = GET;
export const DELETE = GET;

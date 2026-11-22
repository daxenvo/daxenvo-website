import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { followups } from "@/lib/business/followups";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: RouteContext<"/api/followups/[id]">) {
  return handle(request, followups, (await context.params).id);
}
export const PATCH = GET;
export const DELETE = GET;

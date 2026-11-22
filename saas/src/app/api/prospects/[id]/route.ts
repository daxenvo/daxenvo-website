import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { prospects } from "@/lib/business/prospects";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: RouteContext<"/api/prospects/[id]">) {
  return handle(request, prospects, (await context.params).id);
}
export const PATCH = GET;
export const DELETE = GET;

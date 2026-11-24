import type { NextRequest } from "next/server";
import { automation } from "@/lib/automation/api";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: RouteContext<"/api/quote-requests/[id]/followup-automation">) {
  return automation(request, (await context.params).id);
}
export const POST = GET;

import type { NextRequest } from "next/server";
import { qualifications } from "@/lib/qualification/history";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: RouteContext<"/api/quote-requests/[id]/qualifications/latest">) {
  return qualifications(request, (await context.params).id, true);
}

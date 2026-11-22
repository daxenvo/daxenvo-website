import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { appointments } from "@/lib/business/appointments";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: RouteContext<"/api/appointments/[id]">) {
  return handle(request, appointments, (await context.params).id);
}
export const PATCH = GET;
export const DELETE = GET;

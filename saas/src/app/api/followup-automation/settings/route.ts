import type { NextRequest } from "next/server";
import { automation } from "@/lib/automation/api";

export const dynamic = "force-dynamic";
export function PUT(request: NextRequest) {
  return automation(request);
}

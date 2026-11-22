import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { followups } from "@/lib/business/followups";

export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => handle(request, followups);
export const POST = GET;

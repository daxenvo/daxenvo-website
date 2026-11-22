import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { prospects } from "@/lib/business/prospects";

export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => handle(request, prospects);
export const POST = GET;

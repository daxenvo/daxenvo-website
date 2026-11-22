import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { quoteRequests } from "@/lib/business/quote-requests";

export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => handle(request, quoteRequests);
export const POST = GET;

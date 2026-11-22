import type { NextRequest } from "next/server";
import { handle } from "@/lib/business/api";
import { appointments } from "@/lib/business/appointments";

export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => handle(request, appointments);
export const POST = GET;

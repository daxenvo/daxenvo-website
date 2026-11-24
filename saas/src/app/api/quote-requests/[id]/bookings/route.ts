import type {NextRequest} from "next/server";
import {bookingApi} from "@/lib/booking/api";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest,context:RouteContext<"/api/quote-requests/[id]/bookings">) {
  return bookingApi(request,(await context.params).id);
}
export const POST=GET;

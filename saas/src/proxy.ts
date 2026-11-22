import { NextRequest, NextResponse } from "next/server";
import { responseSession } from "@/lib/supabase/response";
import { errorCode, verifiedUser } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  const session = responseSession(request);
  if (request.nextUrl.pathname.startsWith("/espace")) {
    try {
      await verifiedUser(session.client());
    } catch (error) {
      const url = new URL("/connexion", request.url);
      url.searchParams.set("etat", errorCode(error));
      return session.finish(NextResponse.redirect(url, 303));
    }
  }
  return session.finish(
    NextResponse.next({ request: { headers: request.headers } }),
  );
}
export const config = { matcher: ["/espace/:path*", "/connexion"] };

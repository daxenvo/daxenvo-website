import { NextRequest, NextResponse } from "next/server";
import type { SetAllCookies } from "@supabase/ssr";
import { sessionClient } from "./session";

// Les écritures du SDK appartiennent uniquement à cette requête, même en cas de redirection.
export function responseSession(request: NextRequest) {
  const headers = new Headers({
    "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  const writes: Parameters<SetAllCookies>[0] = [];
  const setAll: SetAllCookies = (cookies, sdkHeaders) => {
    for (const cookie of cookies) {
      if (cookie.value) request.cookies.set(cookie.name, cookie.value);
      else request.cookies.delete(cookie.name);
      writes.push(cookie);
    }
    for (const [key, value] of Object.entries(sdkHeaders))
      headers.set(key, value);
  };
  return {
    client: () =>
      sessionClient({ getAll: () => request.cookies.getAll(), setAll }),
    finish(response: NextResponse) {
      headers.forEach((value, key) => response.headers.set(key, value));
      for (const { name, value, options } of writes)
        response.cookies.set(name, value, options);
      return response;
    },
  };
}

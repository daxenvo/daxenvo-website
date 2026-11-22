import "server-only";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { z } from "zod";

export const activeCompanyCookie = "daxenvo-company";
export type AccessCode =
  | "NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "UNAVAILABLE";
export class AccessUnavailable extends Error {
  constructor(public readonly code: AccessCode) {
    super(code);
  }
}

export function configuration() {
  const url = URL.canParse(process.env.SUPABASE_URL ?? "")
    ? new URL(process.env.SUPABASE_URL!)
    : null;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (
    !url ||
    !key?.startsWith("sb_publishable_") ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  ) {
    throw new AccessUnavailable("NOT_CONFIGURED");
  }
  return { url: url.toString(), key };
}

export function sessionClient(cookies: CookieMethodsServer) {
  const { url, key } = configuration();
  return createServerClient(url, key, {
    cookies,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    global: {
      fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
    },
  });
}
type Client = ReturnType<typeof sessionClient>;

export async function verifiedUser(client: Client) {
  const { data, error } = await client.auth.getUser();
  if (
    error &&
    !(
      error.name === "AuthSessionMissingError" ||
      [400, 401, 403].includes(error.status ?? 0)
    )
  )
    throw new AccessUnavailable("UNAVAILABLE");
  if (error || !data.user) throw new AccessUnavailable("UNAUTHENTICATED");
  return data.user;
}

const membership = z.object({
  company_id: z.uuid(),
  role: z.enum(["owner", "admin", "member"]),
  companies: z.object({ name: z.string() }),
});
export async function memberships(client: Client, userId: string) {
  const { data, error } = await client
    .from("company_memberships")
    .select("company_id,role,companies!inner(name)")
    .eq("user_id", userId)
    .order("company_id");
  const parsed = z.array(membership).safeParse(data);
  if (error || !parsed.success) throw new AccessUnavailable("UNAVAILABLE");
  return parsed.data;
}
export function selectCompany(
  list: z.infer<typeof membership>[],
  candidate?: string,
) {
  const active =
    candidate === undefined
      ? list[0]
      : list.find((m) => m.company_id === candidate);
  if (!active) throw new AccessUnavailable("FORBIDDEN");
  return active;
}
export const errorCode = (err: unknown): AccessCode =>
  err instanceof AccessUnavailable ? err.code : "UNAVAILABLE";

import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";

export class AccessUnavailable extends Error {
  constructor(
    public readonly code:
      "NOT_CONFIGURED" | "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE",
  ) {
    super("Accès aux données indisponible");
  }
}
const configuration = z.object({
  url: z.url().refine((value) => new URL(value).protocol === "https:"),
  key: z.string().min(1),
});
export async function createSupabaseServerClient() {
  const config = configuration.safeParse({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  if (!config.success) throw new AccessUnavailable("NOT_CONFIGURED");
  const cookieStore = await cookies();
  return createServerClient(config.data.url, config.data.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        // À utiliser depuis une action/route de session autorisant l'écriture des cookies.
        // Ne pas masquer un échec de renouvellement de session.
        values.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}

// Le navigateur ne fournit qu'un ID candidat. L'identité et l'appartenance sont vérifiées au serveur.
export async function requireCompanyAccess(companyId: string) {
  if (!z.uuid().safeParse(companyId).success)
    throw new AccessUnavailable("FORBIDDEN");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AccessUnavailable("UNAUTHENTICATED");
  const { data: membership, error: membershipError } = await client
    .from("company_memberships")
    .select("company_id, role")
    .eq("company_id", companyId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (membershipError) throw new AccessUnavailable("UNAVAILABLE");
  if (!membership || !["owner", "admin", "member"].includes(membership.role))
    throw new AccessUnavailable("FORBIDDEN");
  return {
    client,
    companyId: membership.company_id as string,
    userId: data.user.id,
  };
}

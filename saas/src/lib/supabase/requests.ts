import "server-only";
import { requireCompanyAccess, AccessUnavailable } from "./server";
// Point d'entrée futur : aucune identité, session ou donnée de secours inventée.
// Non exposé à la démonstration ; requiert une véritable session et une adhésion vérifiée.
export async function listCompanyRequests(companyId: string) {
  const access = await requireCompanyAccess(companyId);
  const { data, error } = await access.client
    .from("quote_requests")
    .select("id, title, status, budget, created_at")
    .eq("company_id", access.companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new AccessUnavailable("UNAVAILABLE");
  return data;
}

import "server-only";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  AccessUnavailable,
  memberships,
  selectCompany,
  sessionClient,
  verifiedUser,
} from "./session";
export { AccessUnavailable };

export async function createSupabaseServerClient() {
  const jar = await cookies();
  // Le proxy a déjà renouvelé la session et transmis les cookies à cette requête.
  return sessionClient({
    getAll: () => jar.getAll(),
    setAll() {
      throw new AccessUnavailable("UNAVAILABLE");
    },
  });
}
export async function requireCompanyAccess(companyId: string) {
  if (!z.uuid().safeParse(companyId).success) throw new AccessUnavailable("FORBIDDEN");
  const client = await createSupabaseServerClient();
  const user = await verifiedUser(client);
  const company = selectCompany(await memberships(client, user.id), companyId);
  return {
    client,
    companyId: company.company_id,
    userId: user.id,
    role: company.role,
  };
}

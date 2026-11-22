import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccessPanel } from "@/components/access-panel";
import { Notice } from "@/components/notice";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  activeCompanyCookie,
  errorCode,
  memberships,
  selectCompany,
  verifiedUser,
} from "@/lib/supabase/session";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Espace entreprise",
  description: "Votre espace entreprise Daxenvo AI.",
};
async function workspace() {
  const client = await createSupabaseServerClient();
  const user = await verifiedUser(client);
  const companies = await memberships(client, user.id);
  const candidate = (await cookies()).get(activeCompanyCookie)?.value;
  let active;
  try {
    active = selectCompany(companies, candidate);
  } catch (e) {
    if (errorCode(e) !== "FORBIDDEN") throw e;
  }
  return { companies, active };
}
export default async function Workspace({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  const { companies, active } = await workspace().catch((error) =>
    redirect("/connexion?etat=" + errorCode(error)),
  );
  const refused = (await searchParams).etat === "FORBIDDEN";
  const roles = {
    owner: "Propriétaire",
    admin: "Administrateur",
    member: "Membre",
  };
  return (
    <AccessPanel title={active?.companies.name ?? "Accès interdit"}>
      {active && <p>Votre rôle · {roles[active.role]}</p>}
      {(!active || refused) && (
        <Notice error>
          {companies.length
            ? "Accès refusé à l’entreprise demandée."
            : "Aucune entreprise n’est associée à votre compte."}
        </Notice>
      )}
      {companies.length > 0 && (
        <form method="post" action="/auth/entreprise">
          <label className="field">
            <span>Entreprise active</span>
            <select
              name="company_id"
              defaultValue={active?.company_id ?? ""}
              required
            >
              {!active && <option value="">Choisir une entreprise</option>}
              {companies.map((m) => (
                <option key={m.company_id} value={m.company_id}>
                  {m.companies.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary">Ouvrir l’entreprise</button>
        </form>
      )}
      <form method="post" action="/auth/deconnexion">
        <button className="btn secondary">Se déconnecter</button>
      </form>
    </AccessPanel>
  );
}

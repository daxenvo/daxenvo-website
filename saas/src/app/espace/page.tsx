import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  UsersRound,
  Files,
  ListTodo,
  CalendarDays,
  Activity,
  Settings2,
} from "lucide-react";
import { AccessPanel } from "@/components/access-panel";
import { Brand, ThemeControl } from "@/components/app-shell";
import { Notice } from "@/components/notice";
import {
  AccessForm,
  CompanyScope,
} from "@/components/client-dashboard/actions";
import { Screens } from "@/components/client-dashboard/screens";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  activeCompanyCookie,
  errorCode,
  memberships,
  selectCompany,
  verifiedUser,
} from "@/lib/supabase/session";
import {
  roleLabels,
  sections,
  workspaceUrl,
  type Section,
} from "@/lib/dashboard/model";
import "./workspace.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Espace entreprise",
  description: "Suivi commercial de votre entreprise.",
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
  return { client, user, companies, active };
}
export default async function Workspace({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [access, params] = await Promise.all([
    workspace().catch((e) => redirect("/connexion?etat=" + errorCode(e))),
    searchParams,
  ]);
  const { companies, active, client, user } = access;
  const select = (
    <>
      {companies.length > 0 && (
        <AccessForm action="/auth/entreprise">
          <label className="field">
            <span>Entreprise active</span>
            <select
              name="company_id"
              required
              defaultValue={active?.company_id ?? ""}
            >
              {!active && <option value="">Choisir une entreprise</option>}
              {companies.map((m) => (
                <option value={m.company_id} key={m.company_id}>
                  {m.companies.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn secondary">Ouvrir l’entreprise</button>
        </AccessForm>
      )}
      <AccessForm action="/auth/deconnexion">
        <button className="btn secondary">Se déconnecter</button>
      </AccessForm>
    </>
  );
  if (!active)
    return (
      <AccessPanel title="Accès interdit">
        <Notice error>
          {companies.length
            ? "Accès refusé à l’entreprise demandée."
            : "Aucune entreprise n’est associée à votre compte."}
        </Notice>
        {select}
      </AccessPanel>
    );
  const view =
    typeof params.vue === "string" && Object.hasOwn(sections, params.vue)
      ? (params.vue as Section)
      : "synthese";
  const icons = {
    synthese: LayoutDashboard,
    prospects: UsersRound,
    demandes: Files,
    relances: ListTodo,
    "rendez-vous": CalendarDays,
    activite: Activity,
    parametres: Settings2,
  };
  return (
    <CompanyScope key={active.company_id} company={active.company_id}>
      <div className="client-shell">
        <a href="#contenu" className="skip-link">
          Aller au contenu
        </a>
        <aside className="client-sidebar">
          <Brand href="/espace" />
          <nav aria-label="Navigation principale">
            {(Object.keys(sections) as Section[]).map((key) => {
              const Icon = icons[key];
              return (
                <a
                  className={"nav-item" + (key === view ? " active" : "")}
                  key={key}
                  href={workspaceUrl(key)}
                  aria-current={key === view ? "page" : undefined}
                >
                  <Icon size={18} />
                  {sections[key]}
                </a>
              );
            })}
          </nav>
          <div className="client-account">{select}</div>
        </aside>
        <div className="client-main">
          <header className="topbar">
            <span>Espace entreprise</span>
            <ThemeControl />
          </header>
          <main id="contenu" className="client-content">
            <header className="page-heading">
              <div>
                <h1>{active.companies.name}</h1>
                <p>Votre rôle · {roleLabels[active.role]}</p>
              </div>
            </header>
            <h2 className="client-title">{sections[view]}</h2>
            {params.etat === "FORBIDDEN" && (
              <Notice error>Accès refusé à l’entreprise demandée.</Notice>
            )}
            <Suspense
              key={JSON.stringify([active.company_id, params])}
              fallback={<Notice>Chargement des données…</Notice>}
            >
              <Screens
                client={client}
                tenant={active.company_id}
                role={active.role}
                params={params}
                email={user.email ?? user.id}
              />
            </Suspense>
          </main>
        </div>
      </div>
    </CompanyScope>
  );
}

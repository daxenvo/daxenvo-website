import { z } from "zod";
import { Notice } from "@/components/notice";
import { statusLabels } from "@/lib/domain/models";
import { prospects } from "@/lib/business/prospects";
import { quoteRequests } from "@/lib/business/quote-requests";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  activitySchema,
  dateLabel,
  label,
  listSchema,
  metricsSchema,
  prospectSchema,
  requestSchema,
  sections,
  settingsSchema,
  workspaceUrl,
  type Role,
  type Section,
} from "@/lib/dashboard/model";
import { PolicyEditor, ProspectEditor, RequestEditor } from "./editors";
import { Automation, Bookings, Qualifications } from "./workflows";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
const querySchema = z.object({
  vue: z
    .enum(Object.keys(sections) as [Section, ...Section[]])
    .default("synthese"),
  q: z.string().max(160).default(""),
  filtre: z.string().max(160).default(""),
  apres: z.string().max(64).default(""),
  lie: z.uuid().optional(),
  id: z.uuid().optional(),
  onglet: z
    .enum(["fiche", "qualification", "relances", "reservation"])
    .default("fiche"),
});
type Query = z.infer<typeof querySchema>;
const listViews = ["prospects", "demandes", "relances", "rendez-vous"];
const filters: Record<string, Record<string, string>> = {
  demandes: { ...statusLabels, attention: "Revue humaine" },
  relances: Object.fromEntries(
    [
      "pending",
      "scheduled",
      "prepared",
      "sent",
      "cancelled",
      "error",
      "manual",
      "done",
      "attention",
    ].map((k) => [k, k === "attention" ? "Intervention nécessaire" : label(k)]),
  ),
  "rendez-vous": Object.fromEntries(
    ["manual", "proposed", "pending", "confirmed", "cancelled", "error"].map(
      (k) => [k, label(k)],
    ),
  ),
};
function relatedLinks(id: string, prospect = false) {
  return (
    <nav aria-label="Activité associée" className="client-links">
      {prospect && (
        <a
          className="btn secondary"
          href={workspaceUrl("demandes", { lie: id })}
        >
          Demandes associées
        </a>
      )}
      <a className="btn secondary" href={workspaceUrl("relances", { lie: id })}>
        Relances associées
      </a>
      <a
        className="btn secondary"
        href={workspaceUrl("rendez-vous", { lie: id })}
      >
        Rendez-vous associés
      </a>
    </nav>
  );
}
async function read(client: Client, tenant: string, panel: string, q?: Query) {
  const result = await client.rpc("client_dashboard", {
    tenant,
    panel,
    term: q?.q ?? "",
    facet: q?.filtre ?? "",
    cursor_key: q?.apres ?? "",
    related: q?.lie ?? null,
  });
  if (result.error) throw Error(result.error.code);
  return result.data;
}
function Activity({ data }: { data: z.infer<typeof activitySchema> }) {
  return (
    <section className="panel client-panel">
      <h2>Activité commerciale récente</h2>
      {!data.length && <p>Aucune activité enregistrée.</p>}
      {data.map((e) => (
        <a
          className="client-row"
          key={e.kind + e.key}
          href={workspaceUrl("demandes", { id: e.request_id, onglet: ({ qualification:"qualification",relance:"relances",evenement:"relances","rendez-vous":"reservation" } as Record<string,string>)[e.kind] })}
        >
          <span>
            <strong>{e.title}</strong>
            <small>
              {label(e.kind)}
              {e.detail
                ? " · " + e.detail.split(">").map(label).join(" → ")
                : ""}
            </small>
          </span>
          <time>{dateLabel(e.stamp)}</time>
        </a>
      ))}
    </section>
  );
}
async function Overview({
  client,
  tenant,
}: {
  client: Client;
  tenant: string;
}) {
  const [metrics, events] = await Promise.allSettled([
    read(client, tenant, "synthese").then((v) => metricsSchema.parse(v)),
    read(client, tenant, "activite").then((v) => activitySchema.parse(v)),
  ]);
  const cards: Array<[keyof z.infer<typeof metricsSchema>, string]> = [
    ["prospects", "Prospects"],
    ["new", "Nouvelles demandes"],
    ["open", "À traiter · nouvelles ou à qualifier"],
    ["priority", "Priorité élevée · demandes ouvertes"],
    ["scheduled", "Relances planifiées"],
    ["attention", "Relances nécessitant une intervention"],
    ["confirmed", "Rendez-vous fournisseur confirmés à venir"],
    ["won", "Demandes gagnées"],
    ["lost", "Demandes perdues"],
  ];
  return (
    <>
      {metrics.status === "fulfilled" ? (
        <div className="stats-grid">
          {cards.map(([key, title]) => (
            <article className="stat-card" key={key}>
              <p className="stat-label">{title}</p>
              <strong className="stat-value">{metrics.value[key]}</strong>
            </article>
          ))}
        </div>
      ) : (
        <Notice error>Indicateurs indisponibles.</Notice>
      )}
      <div className="client-links">
        <a
          className="btn secondary"
          href={workspaceUrl("relances", { filtre: "attention" })}
        >
          Relances à examiner
        </a>
        <a
          className="btn secondary"
          href={workspaceUrl("demandes", { filtre: "attention" })}
        >
          Qualifications à vérifier
        </a>
      </div>
      {events.status === "fulfilled" ? (
        <Activity data={events.value} />
      ) : (
        <Notice error>Activité indisponible.</Notice>
      )}
    </>
  );
}
function Directory({
  q,
  data,
}: {
  q: Query;
  data: z.infer<typeof listSchema>;
}) {
  return (
    <>
      {q.vue === "prospects" && (
        <details className="panel client-panel">
          <summary>Ajouter un prospect</summary>
          <ProspectEditor />
        </details>
      )}
      <section className="panel client-panel">
        <form className="client-filters" method="get" action="/espace">
          <input type="hidden" name="vue" value={q.vue} />
          {q.lie && <input type="hidden" name="lie" value={q.lie} />}
          <label className="field">
            <span>Recherche</span>
            <input
              name="q"
              maxLength={160}
              defaultValue={q.q}
              placeholder={
                q.vue === "prospects" ? "Nom ou ville" : "Objet ou libellé"
              }
            />
          </label>
          <label className="field">
            <span>{q.vue === "prospects" ? "Secteur" : "Filtre"}</span>
            {q.vue === "prospects" ? (
              <input name="filtre" maxLength={160} defaultValue={q.filtre} />
            ) : (
              <select name="filtre" defaultValue={q.filtre}>
                <option value="">Tous</option>
                {Object.entries(filters[q.vue] ?? {}).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </label>
          <button className="btn secondary">Appliquer</button>
        </form>
        {q.lie && (
          <p>
            Vue limitée à la fiche sélectionnée.{" "}
            <a href={workspaceUrl(q.vue)}>Afficher tout</a>
          </p>
        )}
        {!data.length && <p>Aucun résultat pour cette sélection.</p>}
        {data.slice(0, 25).map((row) => {
          const dest =
            q.vue === "prospects"
              ? workspaceUrl("prospects", { id: row.id })
              : workspaceUrl("demandes", {
                  id: row.request_id ?? row.id,
                  onglet:
                    q.vue === "relances"
                      ? "relances"
                      : q.vue === "rendez-vous" && row.state !== "manual"
                        ? "reservation"
                        : "fiche",
                });
          return (
            <a className="client-row" key={row.key} href={dest}>
              <span>
                <strong>{row.title}</strong>
                <small>
                  {row.detail}
                  {row.priority ? " · Priorité " + label(row.priority) : ""}
                  {row.reason ? " · " + label(row.reason) : ""}
                </small>
              </span>
              <span className="client-meta">
                <b className={"badge status-" + row.state}>
                  {q.vue === "prospects" ? row.state : label(row.state)}
                </b>
                {row.stamp && <small>{dateLabel(row.stamp)}</small>}
              </span>
            </a>
          );
        })}
        <nav className="client-links" aria-label="Pagination">
          {q.apres && (
            <a
              href={workspaceUrl(q.vue, {
                q: q.q,
                filtre: q.filtre,
                lie: q.lie,
              })}
            >
              Première page
            </a>
          )}
          {data.length > 25 && (
            <a
              className="btn secondary"
              href={workspaceUrl(q.vue, {
                q: q.q,
                filtre: q.filtre,
                lie: q.lie,
                apres: data[24].key,
              })}
            >
              Page suivante
            </a>
          )}
        </nav>
      </section>
    </>
  );
}
async function detail(client: Client, tenant: string, q: Query, role: Role) {
  const isProspect = q.vue === "prospects";
  const resource = isProspect ? prospects : quoteRequests;
  const row = await client
    .from(resource.table)
    .select(resource.columns)
    .eq("company_id", tenant)
    .eq("id", q.id!)
    .maybeSingle();
  if (row.error) throw Error(row.error.code);
  if (!row.data)
    return <Notice error>Fiche introuvable dans l’entreprise active.</Notice>;
  if (isProspect) {
    const p = prospectSchema.parse(row.data);
    return (
      <>
        <section className="panel client-panel">
          <h2>{p.name}</h2>
          <p>
            {p.sector} · {p.city}
          </p>
          <p>
            {p.email || "E-mail non renseigné"} ·{" "}
            {p.phone || "Téléphone non renseigné"}
          </p>
          {relatedLinks(p.id, true)}
          <details>
            <summary>Modifier le prospect</summary>
            <ProspectEditor key={JSON.stringify(p)} record={p} />
          </details>
        </section>
        <details className="panel client-panel">
          <summary>Créer une demande pour ce prospect</summary>
          <RequestEditor prospect={p.id} />
        </details>
      </>
    );
  }
  const r = requestSchema.parse(row.data);
  const tabs = {
    fiche: "Fiche",
    qualification: "Qualifications",
    relances: "Suivi des relances",
    reservation: "Réservations",
  };
  return (
    <>
      <div>
        <h2>{r.title}</h2>
        <p>
          {label(r.status)} ·{" "}
          <a
            className="client-link"
            href={workspaceUrl("prospects", { id: r.prospect_id })}
          >
            Ouvrir le prospect
          </a>
        </p>
      </div>
      <nav className="client-tabs" aria-label="Rubriques de la demande">
        {Object.entries(tabs).map(([k, v]) => (
          <a
            aria-current={k === q.onglet ? "page" : undefined}
            key={k}
            href={workspaceUrl("demandes", { id: r.id, onglet: k })}
          >
            {v}
          </a>
        ))}
      </nav>
      {q.onglet === "qualification" ? (
        <Qualifications id={r.id} />
      ) : q.onglet === "relances" ? (
        <Automation id={r.id} role={role} />
      ) : q.onglet === "reservation" ? (
        <Bookings id={r.id} role={role} />
      ) : (
        <section className="panel client-panel">
          <h3>Projet</h3>
          <p>{r.description}</p>
          <p>Travaux · {r.project_type || "Non renseignés"}</p>
          <p>Ville · {r.city || "Non renseignée"}</p>
          <p>
            Budget ·{" "}
            {r.budget > 0
              ? r.budget.toLocaleString("fr-FR") + " €"
              : "Non renseigné"}
          </p>
          <p>Délai · {r.requested_timeline || "Non renseigné"}</p>
          {relatedLinks(r.id)}
          <details>
            <summary>Modifier la demande</summary>
            <RequestEditor
              record={r}
              prospect={r.prospect_id}
              key={JSON.stringify(r)}
            />
          </details>
        </section>
      )}
    </>
  );
}
export async function Screens({
  client,
  tenant,
  role,
  params,
  email,
}: {
  client: Client;
  tenant: string;
  role: Role;
  params: Record<string, string | string[] | undefined>;
  email: string;
}) {
  const parsed = querySchema.safeParse(params);
  if (!parsed.success)
    return (
      <Notice error>Les paramètres de consultation sont invalides.</Notice>
    );
  const q = parsed.data;
  async function renderScreen() {
    if (q.id && ["prospects", "demandes"].includes(q.vue))
      return await detail(client, tenant, q, role);
    if (q.vue === "synthese") return await Overview({ client, tenant });
    if (listViews.includes(q.vue))
      return (
        <Directory
          q={q}
          data={listSchema.parse(await read(client, tenant, q.vue, q))}
        />
      );
    if (q.vue === "activite")
      return (
        <>
          <Activity
            data={activitySchema.parse(await read(client, tenant, "activite"))}
          />
          <section className="panel client-panel">
            <h2>Conversations</h2>
            <p>La messagerie sera disponible ultérieurement.</p>
            <p>
              Les changements de statut sont enregistrés depuis l’installation
              du tableau de bord.
            </p>
          </section>
        </>
      );
    const s = settingsSchema.parse(await read(client, tenant, "parametres"));
    return (
      <>
        <section className="panel client-panel">
          <h2>Profil et collaborateurs</h2>
          <p>{email}</p>
          <p>
            Les permissions actuelles donnent accès à votre propre adhésion. Les
            autres collaborateurs et les invitations ne sont pas visibles.
          </p>
        </section>
        <section className="panel client-panel">
          <h2>Calendrier</h2>
          <p>
            {s.calendar
              ? "Configuration enregistrée en base"
              : "Aucun calendrier provisionné"}
          </p>
          <p>Provisionnement par un opérateur. Synchronisation à la demande.</p>
        </section>
        <section className="panel client-panel">
          <h2>Paramètres des relances</h2>
          {s.policy ? (
            <p>
              Délai standard · {s.policy.delay_hours} h · Prioritaire ·{" "}
              {s.policy.urgent_hours} h · Maximum · {s.policy.max_attempts} ·
              Lot · {s.policy.batch_size}
            </p>
          ) : (
            <p>Aucune politique de relance configurée.</p>
          )}
          {role !== "member" && (
            <details>
              <summary>Configurer les relances</summary>
              <PolicyEditor policy={s.policy} />
            </details>
          )}
        </section>
      </>
    );
  }
  return renderScreen().catch((e) => (
    <Notice error>
      {e instanceof Error && e.message === "42501"
        ? "Accès refusé pour cette entreprise."
        : "Données indisponibles. Rechargez la page pour réessayer."}
    </Notice>
  ));
}

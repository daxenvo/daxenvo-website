"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Action, Field, errorText, useWorkspaceApi } from "./actions";
import { Notice } from "@/components/notice";
import { qualificationSchema } from "@/lib/domain/models";
import { dateLabel, label, type Role } from "@/lib/dashboard/model";

function usePage<T>(path: string, schema: z.ZodType<T>) {
  const api = useWorkspaceApi();
  const [version, setVersion] = useState(0);
  const [page, setPage] = useState<{ key: string; data?: T; error?: string }>();
  const key = path + "#" + version;
  useEffect(() => {
    let current = true;
    api(path)
      .then((value) => schema.parse(value))
      .then((data) => {
        if (current) setPage({ key, data });
      })
      .catch((e) => {
        if (current) setPage({ key, error: errorText(e) });
      });
    return () => {
      current = false;
    };
  }, [api, path, schema, key]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: page?.key === key ? page.data : undefined,
    error: page?.key === key ? page.error : undefined,
    refresh,
  };
}
function Waiting({ error }: { error?: string }) {
  return (
    <Notice error={Boolean(error)}>{error ?? "Chargement des données…"}</Notice>
  );
}
const historySchema = z.object({
  data: z.array(
    z.object({
      revision: z.number(),
      created_at: z.string(),
      created_by: z.string().nullable(),
      result: qualificationSchema.extend({ signaux: z.array(z.string()) }),
    }),
  ),
  nextCursor: z.number().nullable(),
});
export function Qualifications({ id }: { id: string }) {
  const path = "/api/quote-requests/" + id + "/qualifications";
  const [before, setBefore] = useState(0);
  const page = usePage(
    path + "?limit=10" + (before ? "&before=" + before : ""),
    historySchema,
  );
  return (
    <section className="panel client-panel">
      <h2>Qualification par règles</h2>
      <Action
        title="Qualifier la demande"
        path={path}
        empty
        confirm="Enregistrer une nouvelle qualification par règles ?"
        onResult={() => {
          setBefore(0);
          page.refresh();
        }}
      />
      {!page.data ? (
        <Waiting error={page.error} />
      ) : (
        <>
          {!page.data.data.length && <p>Aucune qualification enregistrée.</p>}
          {page.data.data.map((q, i) => (
            <article className="client-entry" key={q.revision}>
              <h3>
                {i === 0 && !before
                  ? "Dernière qualification"
                  : "Qualification"}{" "}
                · Révision {q.revision}
              </h3>
              <p>
                {dateLabel(q.created_at)} · Auteur{" "}
                {q.created_by ?? "indisponible"}
              </p>
              <p>
                <strong>
                  Priorité {label(q.result.priorite).toLowerCase()}
                </strong>{" "}
                · {q.result.motif}
              </p>
              <p>Action recommandée · {q.result.actionRecommandee}</p>
              <p>
                Informations manquantes ·{" "}
                {q.result.informationsManquantes.join(", ") || "Aucune"}
              </p>
              <p>Signaux détectés · {q.result.signaux.join(", ") || "Aucun"}</p>
              {q.result.requiresHumanReview && (
                <strong>Intervention humaine requise</strong>
              )}
            </article>
          ))}
          <Pager
            older={
              page.data.nextCursor !== null
                ? () => setBefore(page.data!.nextCursor!)
                : undefined
            }
            first={before ? () => setBefore(0) : undefined}
          />
        </>
      )}
    </section>
  );
}
function Pager({ older, first }: { older?: () => void; first?: () => void }) {
  return (
    <div className="client-links">
      {first && (
        <button className="btn secondary" onClick={first}>
          Première page
        </button>
      )}
      {older && (
        <button className="btn secondary" onClick={older}>
          Page suivante
        </button>
      )}
    </div>
  );
}
const autoSchema = z.object({
  job: z.object({
    state: z.string(),
    reason: z.string(),
    paused: z.boolean(),
    sent_count: z.int(),
    due_at: z.string().nullable(),
    channel: z.string().nullable(),
  }),
  history: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      state: z.string(),
      reason: z.string(),
      happened_at: z.string(),
    }),
  ),
});
export function Automation({ id, role }: { id: string; role: Role }) {
  const path = "/api/quote-requests/" + id + "/followup-automation";
  const [before, setBefore] = useState("");
  const page = usePage(path + (before ? "?before=" + before : ""), autoSchema);
  const [kind, setKind] = useState("pause");
  const events: Record<string, string> = {
    pause: "Suspendre",
    human: "Transmettre au suivi humain",
    delay: "Reporter",
    contact: "Enregistrer un contact",
    interested: "Intérêt exprimé",
    information: "Demande d’informations",
    appointment: "Rendez-vous demandé",
    refused: "Refus de la proposition",
    opt_out: "Enregistrer une opposition",
  };
  if (role !== "member") {
    events.resume = "Reprendre";
    events.preference = "Définir le canal préféré";
  }
  const job = page.data?.job;
  return (
    <section className="panel client-panel">
      <h2>Suivi des relances</h2>
      {!page.data || !job ? (
        <Waiting error={page.error} />
      ) : (
        <>
          <p>
            <strong>{job.paused ? "Suspendue" : label(job.state)}</strong> ·{" "}
            {label(job.reason)}
          </p>
          <p>
            Canal · {job.channel ?? "Non renseigné"} · Envois enregistrés ·{" "}
            {job.sent_count}
          </p>
          {job.due_at && (
            <p>
              {job.state === "error" ? "Reprise prévue" : "Échéance"} ·{" "}
              {dateLabel(job.due_at)}
            </p>
          )}
          <label className="field">
            <span>Action de suivi</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(events)
                .filter(
                  ([k]) =>
                    job.reason !== "opt_out" ||
                    !["resume", "preference", "delay"].includes(k),
                )
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <Action
            key={kind}
            path={path}
            title={events[kind]}
            fixed={{ kind }}
            operation
            confirm={
              kind === "opt_out"
                ? "Enregistrer l’opposition pour toutes les demandes de ce prospect ?"
                : "Enregistrer cette décision de suivi ?"
            }
            onResult={() => {
              setBefore("");
              setKind("pause");
              page.refresh();
            }}
          >
            {kind === "delay" && (
              <Field
                name="value"
                label="Nouvelle échéance ISO avec fuseau (ex. 2026-12-01T09:00:00+01:00)"
              />
            )}
            {kind === "preference" && (
              <Field
                name="value"
                label="Canal"
                options={{ email: "E-mail", sms: "SMS", phone: "Téléphone" }}
              />
            )}
          </Action>
          <h3>Historique des décisions</h3>
          {!page.data.history.length && <p>Aucune décision enregistrée.</p>}
          {page.data.history.map((h) => (
            <p className="client-entry" key={h.id}>
              {dateLabel(h.happened_at)} · {label(h.state)} · {label(h.reason)}
            </p>
          ))}
          <Pager
            first={before ? () => setBefore("") : undefined}
            older={
              page.data.history.length === 25
                ? () => setBefore(String(page.data!.history.at(-1)!.id))
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}

const bookingsSchema = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      status: z.enum([
        "proposed",
        "pending",
        "confirmed",
        "cancelled",
        "error",
      ]),
      start: z.string(),
      minutes: z.number(),
      zone: z.string(),
      error: z.string().nullable(),
      retry_at: z.string().nullable(),
      cancellation_requested: z.boolean(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
const slotsSchema = z.object({
  data: z.array(z.object({ start: z.iso.datetime(), minutes: z.number() })),
});
export function Bookings({ id, role }: { id: string; role: Role }) {
  const path = "/api/quote-requests/" + id + "/bookings";
  const api = useWorkspaceApi();
  const [after, setAfter] = useState(""),
    [link, setLink] = useState("");
  const page = usePage(path + (after ? "?after=" + after : ""), bookingsSchema);
  const [slots, setSlots] = useState<z.infer<typeof slotsSchema>["data"]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function availability(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const date = String(new FormData(e.currentTarget).get("date"));
    setBusy(true);
    setSlots(undefined);
    setError("");
    try {
      const from = new Date(
        Math.max(Date.now() + 60000, Date.parse(date + "T00:00:00Z")),
      ).toISOString();
      const to = new Date(
        Date.parse(date + "T00:00:00Z") + 86400000,
      ).toISOString();
      setSlots(
        slotsSchema.parse(
          await api(path, "POST", {
            action: "availability",
            from,
            to,
            zone: "Europe/Paris",
          }),
        ).data,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel client-panel">
      <h2>Réservation fournisseur</h2>
      {!page.data ? (
        <Waiting error={page.error} />
      ) : (
        <>
          <form className="client-form" onSubmit={availability}>
            <Field label="Journée recherchée (UTC)" name="date" type="date" />
            <button className="btn secondary" disabled={busy}>
              {busy ? "Recherche en cours…" : "Consulter les disponibilités"}
            </button>
          </form>
          {error && <Notice error>{error}</Notice>}
          {slots &&
            (slots.length ? (
              <Action
                path={path}
                title="Proposer le créneau"
                fixed={{ action: "propose", zone: "Europe/Paris" }}
                operation
                onResult={() => {
                  setSlots(undefined);
                  setAfter("");
                  page.refresh();
                }}
              >
                <Field
                  name="start"
                  label="Créneau disponible (heure de Paris)"
                  options={Object.fromEntries(
                    slots.map((s) => [
                      s.start,
                      dateLabel(s.start) + " · " + s.minutes + " min",
                    ]),
                  )}
                />
                <Field
                  name="title"
                  label="Objet du rendez-vous"
                  min={2}
                  max={160}
                />
              </Action>
            ) : (
              <p>Aucun créneau disponible.</p>
            ))}
          {!page.data.data.length && (
            <p>Aucune réservation enregistrée pour cette demande.</p>
          )}
          {page.data.data.map((b) => (
            <article className="client-entry" key={b.id}>
              <h3>{b.title}</h3>
              <p>
                {label(b.status)} · {dateLabel(b.start)} (Paris) · {b.minutes}{" "}
                min
              </p>
              {b.error && (
                <Notice error>
                  Erreur fournisseur · {b.error}
                  {b.retry_at
                    ? " · Reprise à partir du " + dateLabel(b.retry_at)
                    : ""}
                </Notice>
              )}
              {b.cancellation_requested && (
                <p>Annulation demandée, en attente de synchronisation.</p>
              )}
              {b.status === "proposed" && (
                <Action
                  path={path}
                  title="Demander la réservation"
                  fixed={{ action: "reserve", id: b.id }}
                  confirm="Réserver ce créneau et autoriser l’invitation du destinataire indiqué ?"
                  onResult={() => {
                    setSlots(undefined);
                    setLink("");
                    page.refresh();
                  }}
                >
                  <Field name="name" label="Nom de l’invité" max={120} />
                  <Field
                    name="email"
                    type="email"
                    label="E-mail de l’invité"
                    max={254}
                  />
                </Action>
              )}
              <div className="client-links">
                {(["sync", "recover", "reschedule", "cancel"] as const)
                  .filter((action) => {
                    if (b.status === "cancelled") return false;
                    if (action === "sync")
                      return ["pending", "confirmed", "error"].includes(
                        b.status,
                      );
                    if (role === "member") return false;
                    if (action === "reschedule")
                      return b.status === "confirmed";
                    if (action === "recover") return b.status === "error";
                    return true;
                  })
                  .map((action) => (
                    <Action
                      key={action}
                      path={path}
                      title={
                        {
                          sync: "Synchroniser",
                          recover: "Réconcilier",
                          reschedule: "Préparer le déplacement",
                          cancel: "Annuler le rendez-vous",
                        }[action]
                      }
                      fixed={{ action, id: b.id }}
                      confirm={
                        action === "cancel"
                          ? "Annuler définitivement ce rendez-vous ?"
                          : undefined
                      }
                      onResult={(v) => {
                        setSlots(undefined);
                        const url = v?.reschedule_url;
                        setLink(
                          url &&
                            /^https:\/\/calendly\.com\/reschedulings\/[a-zA-Z0-9-]+$/.test(
                              url,
                            )
                            ? url
                            : "",
                        );
                        page.refresh();
                      }}
                    />
                  ))}
              </div>
            </article>
          ))}
          {link && (
            <p>
              <a
                className="btn primary"
                href={link}
                target="_blank"
                rel="noreferrer"
              >
                Déplacer sur Calendly
              </a>{" "}
              Puis synchronisez le rendez-vous.
            </p>
          )}
          <Pager
            first={after ? () => setAfter("") : undefined}
            older={
              page.data.nextCursor
                ? () => setAfter(page.data!.nextCursor!)
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}

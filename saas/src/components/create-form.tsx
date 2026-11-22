"use client";
import { Notice } from "./notice";
import { useState, useId, cloneElement, type ReactElement } from "react";
import { Plus, Info } from "lucide-react";
import { z } from "zod";
import { useDemo } from "./providers";
import { Modal } from "./modal";
import {
  prospectInput,
  requestInput,
  followupInput,
  appointmentInput,
} from "@/lib/domain/models";
import { DEMO_DATE } from "@/lib/domain/fixtures";

export type FormKind = "prospect" | "request" | "followup" | "appointment";
const titles: Record<FormKind, string> = {
  prospect: "Nouveau prospect",
  request: "Nouvelle demande",
  followup: "Planifier un suivi",
  appointment: "Nouveau rendez-vous",
};
export function CreateButton({
  kind,
  compact = false,
}: {
  kind: FormKind;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { persistence } = useDemo();
  return (
    <>
      <button
        className={`btn ${compact ? "secondary" : "primary"}`}
        disabled={persistence === "loading"}
        onClick={() => setOpen(true)}
      >
        <Plus size={17} />
        {titles[kind]}
      </button>
      {open && <CreateForm kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
function CreateForm({
  kind,
  onClose,
}: {
  kind: FormKind;
  onClose: () => void;
}) {
  const { data, dispatch } = useDemo();
  const [error, setError] = useState<string | null>(null);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const f = new FormData(event.currentTarget);
    const text = (key: string) => String(f.get(key) ?? "");
    const identifier = crypto.randomUUID();
    try {
      if (kind === "prospect") {
        const value = prospectInput.parse({
          name: text("name"),
          sector: text("sector"),
          city: text("city"),
        });
        dispatch({
          type: "prospect",
          value: { ...value, id: identifier, createdAt: DEMO_DATE },
        });
      } else if (kind === "request") {
        const value = requestInput.parse({
          prospectId: text("prospectId"),
          title: text("title"),
          description: text("description"),
          typeTravaux: text("typeTravaux"),
          ville: text("ville"),
          budget: Number(text("budget")),
          delai: text("delai"),
        });
        dispatch({
          type: "request",
          value: {
            ...value,
            id: `D-${identifier.slice(0, 8).toUpperCase()}`,
            createdAt: DEMO_DATE,
            status: "nouvelle",
            qualification: null,
          },
        });
      } else if (kind === "followup") {
        dispatch({
          type: "followup",
          value: {
            ...followupInput.parse({
              requestId: text("requestId"),
              title: text("title"),
              dueDate: text("date"),
            }),
            id: identifier,
            done: false,
          },
        });
      } else {
        dispatch({
          type: "appointment",
          value: {
            ...appointmentInput.parse({
              requestId: text("requestId"),
              title: text("title"),
              date: text("date"),
              time: text("time"),
              duration: Number(text("duration")),
            }),
            id: identifier,
          },
        });
      }
      onClose();
    } catch (caught) {
      setError(
        caught instanceof z.ZodError
          ? caught.issues[0].message
          : "Enregistrement impossible. Vérifiez les champs et les limites de la démonstration.",
      );
    }
  }
  return (
    <Modal title={titles[kind]} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="form-note">
          <Info size={15} />
          Utilisez uniquement des exemples fictifs. Sauvegarde dans ce
          navigateur, sans compte ni synchronisation.
        </p>
        <div className="form-grid">
          {kind === "prospect" ? (
            <>
              <Field label="Nom du prospect fictif" wide>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Ex. Atelier Démo"
                  autoFocus
                />
              </Field>
              <Field label="Secteur d’activité">
                <input
                  name="sector"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Ex. Rénovation"
                />
              </Field>
              <Field label="Ville fictive">
                <input
                  name="city"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Ex. Lyon"
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                label={kind === "request" ? "Prospect" : "Demande associée"}
                wide
              >
                <select
                  name={kind === "request" ? "prospectId" : "requestId"}
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choisir un exemple
                  </option>
                  {kind === "request"
                    ? data.prospects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (fictif)
                        </option>
                      ))
                    : data.requests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                </select>
              </Field>
              <Field
                label={kind === "request" ? "Intitulé du projet" : "Objet"}
                wide
              >
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder={
                    kind === "request"
                      ? "Ex. Rénovation d’un bureau fictif"
                      : "Ex. Faire le point sur le projet"
                  }
                  autoFocus
                />
              </Field>
              {kind === "request" ? (
                <>
                  <Field label="Description du projet fictif" wide>
                    <textarea
                      name="description"
                      required
                      minLength={5}
                      maxLength={4000}
                      rows={3}
                      placeholder="Précisez les besoins et contraintes du projet…"
                    />
                  </Field>
                  <Field label="Type de projet">
                    <input
                      name="typeTravaux"
                      maxLength={200}
                      placeholder="Ex. Rénovation, conseil…"
                    />
                  </Field>
                  <Field label="Ville">
                    <input
                      name="ville"
                      maxLength={200}
                      placeholder="Ex. Lyon"
                    />
                  </Field>
                  <Field label="Budget estimé (€) · 0 si inconnu">
                    <input
                      name="budget"
                      type="number"
                      min={0}
                      max={1000000000}
                      step="any"
                      defaultValue={0}
                      required
                    />
                  </Field>
                  <Field label="Délai">
                    <select name="delai" defaultValue="">
                      <option value="">À préciser</option>
                      {[
                        "Dès que possible",
                        "Dans moins d'un mois",
                        "Dans 1 à 3 mois",
                        "Dans 3 à 6 mois",
                        "Dans plus de 6 mois",
                        "Je ne sais pas encore",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Date">
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={DEMO_DATE}
                    />
                  </Field>
                  {kind === "appointment" && (
                    <>
                      <Field label="Heure (Europe/Paris)">
                        <input
                          name="time"
                          type="time"
                          required
                          defaultValue="09:00"
                        />
                      </Field>
                      <Field label="Durée en minutes">
                        <input
                          name="duration"
                          type="number"
                          min={15}
                          max={240}
                          step={15}
                          required
                          defaultValue={30}
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        {error && (
          <Notice error>
            {error}
          </Notice>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" type="submit">
            Enregistrer l’exemple
          </button>
        </div>
      </form>
    </Modal>
  );
}

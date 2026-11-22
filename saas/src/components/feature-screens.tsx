"use client";
import { Notice } from "./notice";
import { useState, useTransition, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import Link from "next/link";
import {
  Search,
  MapPin,
  ArrowUpRight,
  ScanLine,
  Check,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Globe2,
  Sun,
  Moon,
  Monitor,
  RotateCcw,
  CalendarDays,
  Clock3,
  CheckCircle2,
  Circle,
  Info,
  Database,
  LockKeyhole,
} from "lucide-react";
import { useDemo } from "./providers";
import { CreateButton } from "./create-form";
import { Modal } from "./modal";
import { qualifierDemonstration } from "@/app/[locale]/actions";
import { dateLabel, money } from "@/lib/i18n/dictionaries";
import { priorityLabels } from "@/lib/domain/models";
import { DEMO_DATE } from "@/lib/domain/fixtures";

export function ProspectsScreen() {
  const { data } = useDemo();
  const [query, setQuery] = useState("");
  const prospects = data.prospects.filter((p) =>
    `${p.name} ${p.city} ${p.sector}`
      .toLocaleLowerCase("fr")
      .includes(query.toLocaleLowerCase("fr")),
  );
  return (
    <section>
      <div className="section-toolbar">
        <span className="muted">
          {data.prospects.length} prospects fictifs · aucun contact réel
        </span>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Rechercher un prospect"
            placeholder="Nom, ville, secteur…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="prospect-grid">
        {prospects.map((p, i) => {
          const requests = data.requests.filter((r) => r.prospectId === p.id);
          return (
            <article className="panel prospect-card" key={p.id}>
              <div className="prospect-top">
                <span className={`company-avatar color-${i % 4}`}>
                  {p.name
                    .split(" ")
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </span>
                <span className="subtle-label">Fictif</span>
              </div>
              <h2>{p.name}</h2>
              <p>{p.sector}</p>
              <div className="prospect-city">
                <MapPin size={14} />
                {p.city}
              </div>
              <div className="prospect-stats">
                <span>
                  {requests.length} demande{requests.length > 1 ? "s" : ""}
                </span>
                <strong>
                  {money(requests.reduce((sum, r) => sum + r.budget, 0))}
                </strong>
              </div>
              <Link className="text-link" href="/fr/demandes">
                Explorer les demandes <ArrowUpRight size={15} />
              </Link>
            </article>
          );
        })}
      </div>
      {!prospects.length && (
        <div className="panel empty-state">
          <Search size={24} />
          <h2>Aucun prospect trouvé</h2>
          <p>Modifiez votre recherche ou ajoutez un exemple.</p>
        </div>
      )}
    </section>
  );
}

export function QualificationScreen() {
  const { data, dispatch, persistence } = useDemo();
  const params = useSearchParams();
  const [selectedId, setSelectedId] = useState(
    params.get("demande") ?? data.requests[0]?.id ?? "",
  );
  const request = data.requests.find((r) => r.id === selectedId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function qualify() {
    if (!request) return;
    const candidate = request;
    setError(null);
    startTransition(async () => {
      try {
        const response = await qualifierDemonstration({
          description: candidate.description,
          budget: candidate.budget > 0 ? `${candidate.budget} €` : "",
          delai: candidate.delai,
          typeTravaux: candidate.typeTravaux,
          ville: candidate.ville,
        });
        if (!response.ok) {
          setError(response.error);
          return;
        }
        dispatch({
          type: "qualify",
          id: candidate.id,
          qualification: response.result,
        });
      } catch {
        setError(
          "Le serveur de démonstration est indisponible. Votre demande reste enregistrée localement.",
        );
      }
    });
  }
  return (
    <div>
      <div className="security-banner">
        <ScanLine size={20} />
        <div>
          <strong>Qualification locale · moteur de règles J6</strong>
          <p>
            Ce parcours n’utilise pas d’intelligence artificielle. Aucun appel
            OpenAI ni envoi à un service tiers.
          </p>
        </div>
        <span className="badge status-qualifiee">Sans coût API</span>
      </div>
      <div className="qualification-grid">
        <section className="panel qualification-input">
          <div className="panel-heading">
            <div>
              <h2>Une demande à comprendre</h2>
              <p>Analysez un exemple avec les règles métier.</p>
            </div>
          </div>
          <label className="field">
            <span>Choisir une demande fictive</span>
            <select
              aria-label="Demande à qualifier"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setError(null);
              }}
              disabled={pending || persistence === "loading"}
            >
              <option value="" disabled>
                Choisir une demande
              </option>
              {data.requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.title}
                </option>
              ))}
            </select>
          </label>
          {request ? (
            <>
              <span className="eyebrow">{request.id}</span>
              <h3>{request.title}</h3>
              <p className="project-description">{request.description}</p>
              <dl className="qualification-facts">
                <dt>Nature du projet</dt>
                <dd>{request.typeTravaux || "À préciser"}</dd>
                <dt>Budget annoncé</dt>
                <dd>{request.budget ? money(request.budget) : "À préciser"}</dd>
                <dt>Délai souhaité</dt>
                <dd>{request.delai || "À préciser"}</dd>
                <dt>Ville</dt>
                <dd>{request.ville || "À préciser"}</dd>
              </dl>
              <button
                className="btn primary full-width"
                onClick={qualify}
                aria-busy={pending}
                disabled={pending || persistence === "loading"}
              >
                <ScanLine size={17} />
                {pending
                  ? "Qualification en cours…"
                  : request.qualification
                    ? "Relancer la qualification locale"
                    : "Qualifier avec les règles locales"}
              </button>
            </>
          ) : (
            <p className="empty-state">
              Sélectionnez une demande valide pour commencer.
            </p>
          )}
          {error && (
            <Notice error>
              {error}
            </Notice>
          )}
        </section>
        <section className="panel qualification-result" aria-live="polite">
          <div className="panel-heading">
            <div>
              <h2>Résultat de la qualification</h2>
              <p>Une aide à la décision, pas une action automatique.</p>
            </div>
            <ShieldCheck size={19} className="muted" />
          </div>
          {request?.qualification ? (
            <div className="result-content">
              <div className="result-priority">
                <span className="muted">Priorité proposée</span>
                <strong
                  className={`priority-${request.qualification.priorite}`}
                >
                  {priorityLabels[request.qualification.priorite]}
                </strong>
                <span className="subtle-label">
                  Analysé par les règles J6 · pas par une IA
                </span>
              </div>
              <h3>Pourquoi cette priorité ?</h3>
              <p>{request.qualification.motif}</p>
              <h3>Prochaine action recommandée</h3>
              <div className="next-action">
                <ArrowRight size={17} />
                <p>{request.qualification.actionRecommandee}</p>
              </div>
              <h3>Informations à préciser</h3>
              {request.qualification.informationsManquantes.length ? (
                <ul className="missing-list">
                  {request.qualification.informationsManquantes.map((field) => (
                    <li key={field}>
                      <AlertTriangle size={14} />
                      {(
                        {
                          description: "Description",
                          budget: "Budget",
                          delai: "Délai",
                          typeTravaux: "Type de projet",
                          ville: "Ville",
                        } as Record<string, string>
                      )[field] ?? field}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="success-text">
                  <Check size={15} />
                  Les cinq informations métier sont renseignées.
                </p>
              )}
              <div
                className={`review-note ${request.qualification.requiresHumanReview ? "warning" : ""}`}
              >
                <Info size={17} />
                <span>
                  {request.qualification.requiresHumanReview
                    ? "Validation humaine nécessaire avant toute suite commerciale."
                    : "Relisez le résultat avant de décider de la suite commerciale."}
                </span>
              </div>
            </div>
          ) : (
            <div className="qualification-placeholder">
              <span>
                <ScanLine size={35} strokeWidth={1.2} />
              </span>
              <h3>Faites émerger la prochaine étape.</h3>
              <p>
                Sélectionnez un projet et lancez la qualification pour voir la
                priorité, les informations manquantes et une action recommandée.
              </p>
              <small>Aucune analyse IA n’a été effectuée.</small>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function FollowupsScreen() {
  const { data, dispatch, persistence } = useDemo();
  const open = data.followups.filter((f) => !f.done);
  return (
    <div>
      <div className="section-summary">
        <span>
          <strong>{open.length}</strong> actions à réaliser
        </span>
        <span>
          <strong>{data.followups.length - open.length}</strong> terminées
        </span>
        <span>Référence fictive : {dateLabel(DEMO_DATE, true)}</span>
      </div>
      <div className="followup-grid">
        {[
          { title: "À réaliser", done: false },
          { title: "Terminées", done: true },
        ].map((column) => (
          <section className="followup-column" key={column.title}>
            <h2>
              <span className={column.done ? "dot-green" : "dot-amber"} />
              {column.title}
              <span className="count">
                {data.followups.filter((f) => f.done === column.done).length}
              </span>
            </h2>
            {[...data.followups]
              .filter((f) => f.done === column.done)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .map((followup) => (
                <article
                  className={`panel followup-card ${followup.done ? "completed" : ""}`}
                  key={followup.id}
                >
                  <div className="followup-card-top">
                    <span className="eyebrow">{followup.requestId}</span>
                    <button
                      className="icon-button"
                      aria-label={`${followup.done ? "Rouvrir" : "Terminer"} : ${followup.title}`}
                      disabled={persistence === "loading"}
                      onClick={() =>
                        dispatch({ type: "toggle-followup", id: followup.id })
                      }
                    >
                      {followup.done ? (
                        <CheckCircle2 size={22} />
                      ) : (
                        <Circle size={22} />
                      )}
                    </button>
                  </div>
                  <h3>{followup.title}</h3>
                  <p>
                    {
                      data.requests.find((r) => r.id === followup.requestId)
                        ?.title
                    }
                  </p>
                  <div className="followup-due">
                    <CalendarDays size={14} />
                    {dateLabel(followup.dueDate, true)}
                    {!followup.done && followup.dueDate <= DEMO_DATE && (
                      <span className="due-label">À traiter</span>
                    )}
                  </div>
                </article>
              ))}
            {data.followups.every((f) => f.done !== column.done) && (
              <div className="empty-state">
                <CheckCircle2 size={25} />
                <p>Aucune action dans cette colonne.</p>
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="footnote">
        Un suivi est une tâche locale. Aucun email, SMS ou rappel externe n’est
        envoyé.
      </p>
    </div>
  );
}

export function AppointmentsScreen() {
  const { data } = useDemo();
  const appointments = [...data.appointments].sort((a, b) =>
    `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`),
  );
  const days = [...new Set(appointments.map((a) => a.date))];
  return (
    <div className="appointments-layout">
      <div className="appointments-list">
        {days.map((day) => (
          <section key={day}>
            <h2 className="date-heading">
              {new Intl.DateTimeFormat("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Europe/Paris",
              }).format(new Date(`${day}T12:00:00Z`))}
              <span>
                {appointments.filter((a) => a.date === day).length} rendez-vous
              </span>
            </h2>
            {appointments
              .filter((a) => a.date === day)
              .map((a) => (
                <article className="panel appointment-card" key={a.id}>
                  <div className="appointment-time">
                    <strong>{a.time}</strong>
                    <span>{a.duration} min</span>
                  </div>
                  <span className="appointment-line" />
                  <div>
                    <span className="eyebrow">
                      {a.requestId} · EXEMPLE FICTIF
                    </span>
                    <h3>{a.title}</h3>
                    <p>
                      {data.requests.find((r) => r.id === a.requestId)?.title}
                    </p>
                  </div>
                  <CalendarDays size={20} className="muted" />
                </article>
              ))}
          </section>
        ))}
        {!days.length && (
          <div className="panel empty-state">
            <CalendarDays size={30} />
            <h2>Votre agenda est libre.</h2>
            <p>Ajoutez un premier rendez-vous fictif.</p>
            <CreateButton kind="appointment" />
          </div>
        )}
      </div>
      <aside className="panel agenda-explainer">
        <span className="stat-icon blue">
          <Clock3 size={23} />
        </span>
        <h2>Du temps pour chaque projet.</h2>
        <p>Retrouvez vos échanges dans un agenda simple, ordonné par date.</p>
        <div className="review-note">
          <Info size={17} />
          <span>
            Agenda de démonstration en heure de Paris. Aucun calendrier externe
            connecté, aucune invitation envoyée.
          </span>
        </div>
      </aside>
    </div>
  );
}

const subscribeMounted = () => () => {};
export function SettingsScreen() {
  const { theme, setTheme } = useTheme();
  const ready = useSyncExternalStore(
    subscribeMounted,
    () => true,
    () => false,
  );
  const { reset } = useDemo();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="settings-layout">
      <section className="panel settings-section">
        <div className="settings-heading">
          <Sun size={20} />
          <div>
            <h2>Apparence</h2>
            <p>Choisissez l’ambiance de votre espace de travail.</p>
          </div>
        </div>
        <div
          className="theme-options"
          role="group"
          aria-label="Apparence de l’application"
        >
          {(
            [
              [
                "light",
                "Clair",
                "Une lumière douce, des tons chaleureux.",
                Sun,
              ],
              [
                "dark",
                "Sombre",
                "Un espace posé, pour rester concentré.",
                Moon,
              ],
              [
                "system",
                "Système",
                "Suit automatiquement votre appareil.",
                Monitor,
              ],
            ] as const
          ).map(([value, name, description, Icon]) => (
            <button
              className={`theme-option ${ready && theme === value ? "selected" : ""}`}
              key={value}
              aria-pressed={ready && theme === value}
              onClick={() => setTheme(value)}
            >
              <div className={`theme-preview preview-${value}`}>
                <span />
                <span />
                <span />
              </div>
              <span className="theme-name">
                <Icon size={16} />
                {name}
                {ready && theme === value && <CheckCircle2 size={15} />}
              </span>
              <small>{description}</small>
            </button>
          ))}
        </div>
        <p className="footnote">
          Préférence mémorisée dans ce navigateur. L’option système suit les
          changements de votre appareil.
        </p>
      </section>
      <section className="panel settings-section">
        <div className="settings-heading">
          <Globe2 size={20} />
          <div>
            <h2>Langue et région</h2>
            <p>Une structure prête à accueillir d’autres langues.</p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Langue de l’interface</strong>
            <p>Le français est la seule langue disponible à ce stade.</p>
          </div>
          <span className="setting-value">Français (France)</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>Formats de démonstration</strong>
            <p>Devise en euros · dates françaises · fuseau Europe/Paris.</p>
          </div>
          <span className="subtle-label">FR · EUR</span>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="settings-heading">
          <LockKeyhole size={20} />
          <div>
            <h2>Compte, données et intégrations</h2>
            <p>État réel des fondations, sans connexion simulée.</p>
          </div>
        </div>
        {[
          [
            "Authentification Supabase",
            "Aucune session utilisateur ni connexion active. L’interface de connexion reste à développer.",
            "Non activée",
          ],
          [
            "Isolation par entreprise",
            "Schéma SQL et politiques RLS préparés. Migration et tests sur base réelle non exécutés.",
            "À valider",
          ],
          [
            "Qualification OpenAI",
            "Adaptateur J6 conservé côté serveur. Aucun modèle chargé dans cette démonstration.",
            "Désactivée",
          ],
          [
            "Stockage de démonstration",
            "Exemples conservés dans votre navigateur. Aucune synchronisation ni garantie de sauvegarde.",
            "Local uniquement",
          ],
        ].map(([name, description, state]) => (
          <div className="settings-row" key={name}>
            <div>
              <strong>{name}</strong>
              <p>{description}</p>
            </div>
            <span className="subtle-label">{state}</span>
          </div>
        ))}
      </section>
      <section className="panel settings-section">
        <div className="settings-heading">
          <Database size={20} />
          <div>
            <h2>Données de démonstration</h2>
            <p>Repartez des exemples initiaux à tout moment.</p>
          </div>
        </div>
        <div className="settings-row">
          <p>
            La réinitialisation remplace vos prospects, demandes,
            qualifications, suivis et rendez-vous locaux.
          </p>
          <button
            className="btn secondary"
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw size={15} />
            Réinitialiser les exemples
          </button>
        </div>
      </section>
      {confirmReset && (
        <Modal
          title="Réinitialiser la démonstration ?"
          onClose={() => setConfirmReset(false)}
        >
          <p className="reset-copy">
            Les exemples ajoutés dans ce navigateur seront remplacés par les
            données fictives initiales. Cette action ne touche aucune base
            distante.
          </p>
          <div className="modal-actions">
            <button
              className="btn secondary"
              onClick={() => setConfirmReset(false)}
            >
              Annuler
            </button>
            <button
              className="btn primary"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              Confirmer la réinitialisation
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

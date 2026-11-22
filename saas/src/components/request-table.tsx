"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  Files,
  MapPin,
} from "lucide-react";
import { useDemo } from "./providers";
import { Modal } from "./modal";
import {
  statuses,
  statusLabels,
  priorityLabels,
  type QuoteRequest,
} from "@/lib/domain/models";
import { money, dateLabel } from "@/lib/i18n/dictionaries";

export function StatusBadge({ status }: { status: QuoteRequest["status"] }) {
  return (
    <span className={`badge status-${status}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
export function RequestTable({ compact = false }: { compact?: boolean }) {
  const { data, dispatch, persistence } = useDemo();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.requests.find((r) => r.id === selectedId);
  const rows = data.requests.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      `${r.title} ${data.prospects.find((p) => p.id === r.prospectId)?.name ?? ""} ${r.id}`
        .toLocaleLowerCase("fr")
        .includes(query.toLocaleLowerCase("fr")),
  );
  const visible = compact ? rows.slice(0, 4) : rows;
  return (
    <>
      <div className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {compact ? "Dernières demandes" : "Toutes les demandes"}
              <span className="count">{data.requests.length}</span>
            </h2>
            {compact && <p>Les projets qui viennent de vous être confiés.</p>}
          </div>
          {compact && (
            <Link className="text-link" href="/fr/demandes">
              Tout voir <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
        {!compact && (
          <div className="table-tools">
            <label className="search-field">
              <Search size={17} />
              <input
                aria-label="Rechercher une demande"
                placeholder="Rechercher un projet, un prospect…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="filter-field">
              <SlidersHorizontal size={15} />
              <select
                aria-label="Filtrer les demandes par statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">Tous les statuts</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  Projet <ArrowDown size={12} />
                </th>
                <th>Prospect</th>
                <th>Budget estimé</th>
                <th>Statut</th>
                <th>Date</th>
                <th>
                  <span className="sr-only">Consulter</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((request) => (
                <tr key={request.id}>
                  <td>
                    <button
                      className="project-link"
                      onClick={() => setSelectedId(request.id)}
                    >
                      <span className="table-project-icon">
                        <Files size={16} />
                      </span>
                      <span>
                        <strong>{request.title}</strong>
                        <small>{request.id}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="prospect-name">
                      {
                        data.prospects.find((p) => p.id === request.prospectId)
                          ?.name
                      }
                    </span>
                  </td>
                  <td className="number">
                    {request.budget ? money(request.budget) : "À préciser"}
                  </td>
                  <td>
                    <StatusBadge status={request.status} />
                  </td>
                  <td className="muted nowrap">
                    {dateLabel(request.createdAt)}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Consulter ${request.title}`}
                      onClick={() => setSelectedId(request.id)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="empty-state">
              <Search size={25} />
              <h3>Aucune demande trouvée</h3>
              <p>Essayez un autre mot ou un autre statut.</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {visible.length} demande{visible.length > 1 ? "s" : ""} affichée
            {visible.length > 1 ? "s" : ""}
          </span>
          <span>Exemples fictifs · budgets indicatifs</span>
        </div>
      </div>
      {selected && (
        <Modal title={selected.title} onClose={() => setSelectedId(null)}>
          <div className="request-details">
            <div className="detail-meta">
              <StatusBadge status={selected.status} />
              <span>
                <MapPin size={14} />
                {selected.ville || "Ville à préciser"}
              </span>
              <strong>
                {selected.budget ? money(selected.budget) : "Budget à préciser"}
              </strong>
            </div>
            <p>{selected.description}</p>
            <dl>
              <dt>Type de projet</dt>
              <dd>{selected.typeTravaux || "À préciser"}</dd>
              <dt>Calendrier déclaré</dt>
              <dd>{selected.delai || "À préciser"}</dd>
              <dt>Qualification locale</dt>
              <dd>
                {selected.qualification
                  ? `${priorityLabels[selected.qualification.priorite]} · règles J6`
                  : "Pas encore effectuée"}
              </dd>
            </dl>
            <label className="field">
              <span>Faire évoluer le statut de démonstration</span>
              <select
                aria-label="Statut de la demande"
                disabled={persistence === "loading"}
                value={selected.status}
                onChange={(e) =>
                  dispatch({
                    type: "status",
                    id: selected.id,
                    status: e.target.value as QuoteRequest["status"],
                  })
                }
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-note">
              Changement local uniquement. Aucun devis ni message n’est envoyé.
            </p>
            <Link
              className="btn primary"
              href={`/fr/qualification?demande=${encodeURIComponent(selected.id)}`}
              onClick={() => setSelectedId(null)}
            >
              Qualifier cette demande <ArrowUpRight size={16} />
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}

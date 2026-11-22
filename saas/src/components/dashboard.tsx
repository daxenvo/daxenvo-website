"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  UsersRound,
  Wallet,
  ScanLine,
  ListTodo,
  CircleCheck,
  CalendarDays,
  Clock3,
  Sparkles,
} from "lucide-react";
import { useDemo } from "./providers";
import { RequestTable } from "./request-table";
import { dashboardMetrics } from "@/lib/domain/operations";
import { DEMO_DATE } from "@/lib/domain/fixtures";
import { dateLabel, money } from "@/lib/i18n/dictionaries";

export function Dashboard() {
  const { data } = useDemo();
  const metrics = dashboardMetrics(data);
  const [period, setPeriod] = useState<7 | 30>(30);
  const start =
    new Date(`${DEMO_DATE}T12:00:00Z`).getTime() - (period - 1) * 86400000;
  const inPeriod = data.requests.filter(
    (r) =>
      new Date(`${r.createdAt}T12:00:00Z`).getTime() >= start &&
      r.createdAt <= DEMO_DATE,
  );
  const bucketCount = period === 7 ? 7 : 10;
  const bars = Array.from({ length: bucketCount }, (_, i) => {
    const begin = start + ((i * period) / bucketCount) * 86400000;
    const end = start + (((i + 1) * period) / bucketCount) * 86400000;
    return inPeriod.filter((r) => {
      const time = new Date(`${r.createdAt}T12:00:00Z`).getTime();
      return time >= begin && time < end;
    }).length;
  });
  const max = Math.max(1, ...bars);
  const upcoming = [...data.appointments]
    .filter((a) => a.date >= DEMO_DATE)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .slice(0, 2);
  const stats = [
    {
      label: "Prospects",
      value: metrics.prospects,
      note: "Relations à développer",
      Icon: UsersRound,
      href: "/fr/prospects",
      color: "blue",
    },
    {
      label: "Potentiel des projets",
      value: money(metrics.pipeline),
      note: `${metrics.active} demandes actives · estimations`,
      Icon: Wallet,
      href: "/fr/demandes",
      color: "green",
    },
    {
      label: "Demandes à qualifier",
      value: metrics.toQualify,
      note: "Une prochaine étape à identifier",
      Icon: ScanLine,
      href: "/fr/qualification",
      color: "amber",
    },
    {
      label: "Suivis à réaliser",
      value: metrics.followups,
      note: "Pour garder le bon rythme",
      Icon: ListTodo,
      href: "/fr/suivi",
      color: "amber",
    },
  ];
  return (
    <div className="dashboard">
      <div className="stats-grid">
        {stats.map(({ label, value, note, Icon, href, color }) => (
          <Link href={href} className="stat-card" key={label}>
            <div className="stat-label">
              <span>{label}</span>
              <span className={`stat-icon ${color}`}>
                <Icon size={18} />
              </span>
            </div>
            <div className="stat-value">
              {value}
              <ArrowUpRight size={18} />
            </div>
            <p>{note}</p>
          </Link>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Votre activité en un coup d’œil</h2>
              <p>Demandes reçues · période fictive au {dateLabel(DEMO_DATE)}</p>
            </div>
            <div
              className="segmented"
              role="group"
              aria-label="Période de l’activité"
            >
              {([7, 30] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => setPeriod(days)}
                  aria-pressed={period === days}
                >
                  {days} jours
                </button>
              ))}
            </div>
          </div>
          <div className="chart-head">
            <strong>
              {inPeriod.length}
              <span>demandes sur la période</span>
            </strong>
            <span className="chart-legend">
              <i />
              Demandes de devis
            </span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={`${inPeriod.length} demandes sur les ${period} derniers jours fictifs`}
          >
            <div className="chart-axis">
              {[max, Math.round(max / 2), 0].map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
            <div className="chart-plot">
              <div className="chart-grid" />
              {bars.map((count, i) => (
                <div className="chart-column" key={i}>
                  <span className="bar-value">{count}</span>
                  <div
                    className={`chart-bar ${count === max ? "highlight" : ""}`}
                    style={{ height: `${Math.max((count / max) * 100, 2)}%` }}
                  >
                    <span className="sr-only">
                      Groupe {i + 1} : {count} demandes
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-labels">
            <span>{dateLabel(new Date(start).toISOString().slice(0, 10))}</span>
            <span>{period === 30 ? "Novembre 2026" : "7 jours fictifs"}</span>
            <span>{dateLabel(DEMO_DATE)}</span>
          </div>
        </section>
        <section className="panel pipeline-panel">
          <div className="panel-heading">
            <div>
              <h2>Avancement des projets</h2>
              <p>Du besoin à la concrétisation.</p>
            </div>
            <span className="small-icon">
              <Sparkles size={17} />
            </span>
          </div>
          <div className="pipeline-total">
            <strong>{data.requests.length}</strong>
            <span>opportunités dans votre espace</span>
          </div>
          <div className="pipeline-stacked" aria-hidden="true">
            {[
              {
                value: data.requests.filter((r) =>
                  ["nouvelle", "a_qualifier"].includes(r.status),
                ).length,
                color: "amber",
              },
              {
                value: data.requests.filter((r) =>
                  ["qualifiee", "en_cours"].includes(r.status),
                ).length,
                color: "blue",
              },
              { value: metrics.won, color: "green" },
              {
                value: data.requests.filter((r) => r.status === "perdue")
                  .length,
                color: "muted",
              },
            ].map((s, i) => (
              <span className={s.color} key={i} style={{ flex: s.value }} />
            ))}
          </div>
          <div className="pipeline-rows">
            {[
              {
                label: "À découvrir / qualifier",
                count: data.requests.filter((r) =>
                  ["nouvelle", "a_qualifier"].includes(r.status),
                ).length,
                color: "amber",
              },
              {
                label: "Qualifiées / devis en cours",
                count: data.requests.filter((r) =>
                  ["qualifiee", "en_cours"].includes(r.status),
                ).length,
                color: "blue",
              },
              { label: "Gagnées", count: metrics.won, color: "green" },
              {
                label: "Perdues",
                count: data.requests.filter((r) => r.status === "perdue")
                  .length,
                color: "muted",
              },
            ].map((s) => (
              <div key={s.label}>
                <span>
                  <i className={s.color} />
                  {s.label}
                </span>
                <strong>{s.count}</strong>
              </div>
            ))}
          </div>
          <Link href="/fr/demandes" className="panel-bottom-link">
            Explorer les demandes <ArrowRight size={15} />
          </Link>
        </section>
      </div>
      <RequestTable compact />
      <div className="lower-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>À l’agenda</h2>
              <p>Vos prochains échanges fictifs.</p>
            </div>
            <Link className="text-link" href="/fr/rendez-vous">
              Voir l’agenda <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="agenda-preview">
            {upcoming.map((a) => (
              <div className="agenda-row" key={a.id}>
                <div className="date-tile">
                  <span>{dateLabel(a.date).split(" ").slice(1).join(" ")}</span>
                  <strong>
                    {new Date(`${a.date}T12:00:00Z`).getUTCDate()}
                  </strong>
                </div>
                <div>
                  <strong>{a.title}</strong>
                  <p>
                    {
                      data.prospects.find(
                        (p) =>
                          p.id ===
                          data.requests.find((r) => r.id === a.requestId)
                            ?.prospectId,
                      )?.name
                    }{" "}
                    · fictif
                  </p>
                </div>
                <span className="agenda-time">
                  <Clock3 size={13} />
                  {a.time}
                </span>
              </div>
            ))}
            {upcoming.length === 0 && (
              <p className="empty-state">Aucun rendez-vous à venir.</p>
            )}
          </div>
        </section>
        <section className="insight-panel">
          <div className="insight-icon">
            <CircleCheck size={23} />
          </div>
          <div>
            <span className="eyebrow">CHAQUE DEMANDE MÉRITE UNE SUITE</span>
            <h2>
              Une opportunité commence
              <br />
              par une bonne compréhension.
            </h2>
            <p>
              Explorez la qualification J6 : une analyse par règles,
              transparente et sans appel IA.
            </p>
            <Link href="/fr/qualification">
              Découvrir la qualification <ArrowRight size={16} />
            </Link>
          </div>
          <CalendarDays
            className="insight-decoration"
            size={112}
            strokeWidth={0.7}
          />
        </section>
      </div>
    </div>
  );
}

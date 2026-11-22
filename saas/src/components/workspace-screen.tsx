"use client";
import { Suspense } from "react";
import { CalendarDays } from "lucide-react";
import { fr, dateLabel, type Section } from "@/lib/i18n/dictionaries";
import { DEMO_DATE } from "@/lib/domain/fixtures";
import { Dashboard } from "./dashboard";
import { CreateButton } from "./create-form";
import { RequestTable } from "./request-table";
import {
  ProspectsScreen,
  QualificationScreen,
  FollowupsScreen,
  AppointmentsScreen,
  SettingsScreen,
} from "./feature-screens";
export function WorkspaceScreen({ section }: { section: Section }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VOTRE ACTIVITÉ, PLUS SIMPLEMENT</span>
          <h1>
            {fr.navigation[section]}
            <span className="heading-dot">.</span>
          </h1>
          <p>{fr.descriptions[section]}</p>
        </div>
        <div className="page-heading-actions">
          {section === "tableau-de-bord" && (
            <span className="date-chip">
              <CalendarDays size={15} />
              {dateLabel(DEMO_DATE, true)}
            </span>
          )}
          {["tableau-de-bord", "demandes"].includes(section) && (
            <CreateButton kind="request" />
          )}
          {section === "prospects" && <CreateButton kind="prospect" />}
          {section === "suivi" && <CreateButton kind="followup" />}
          {section === "rendez-vous" && <CreateButton kind="appointment" />}
        </div>
      </div>
      {section === "tableau-de-bord" && <Dashboard />}
      {section === "prospects" && <ProspectsScreen />}
      {section === "demandes" && <RequestTable />}
      {section === "qualification" && (
        <Suspense fallback={<p>Chargement de la qualification…</p>}>
          <QualificationScreen />
        </Suspense>
      )}
      {section === "suivi" && <FollowupsScreen />}
      {section === "rendez-vous" && <AppointmentsScreen />}
      {section === "parametres" && <SettingsScreen />}
    </>
  );
}

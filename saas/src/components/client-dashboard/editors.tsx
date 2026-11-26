import { Action, Field } from "./actions";
import { statusLabels } from "@/lib/domain/models";
import {
  type ClientProspect,
  type ClientRequest,
  type Settings,
} from "@/lib/dashboard/model";

export function ProspectEditor({ record }: { record?: ClientProspect }) {
  return (
    <Action
      title={record ? "Enregistrer le prospect" : "Créer le prospect"}
      createdIn={record ? undefined : "prospects"}
      path={"/api/prospects" + (record ? "/" + record.id : "")}
      method={record ? "PATCH" : "POST"}
    >
      <Field
        name="name"
        label="Nom du prospect"
        value={record?.name}
        min={2}
        max={160}
      />
      <Field
        name="sector"
        label="Secteur"
        value={record?.sector}
        min={2}
        max={160}
      />
      <Field name="city" label="Ville" value={record?.city} min={2} max={160} />
      <Field
        name="email"
        label="Adresse e-mail de contact"
        type="email"
        value={record?.email}
        max={254}
        required={false}
      />
      <Field
        name="phone"
        label="Téléphone"
        type="tel"
        value={record?.phone}
        max={40}
        required={false}
      />
    </Action>
  );
}
export function RequestEditor({
  prospect,
  record,
}: {
  prospect: string;
  record?: ClientRequest;
}) {
  return (
    <Action
      title={record ? "Enregistrer la demande" : "Créer la demande"}
      path={"/api/quote-requests" + (record ? "/" + record.id : "")}
      method={record ? "PATCH" : "POST"}
      createdIn={record ? undefined : "demandes"}
      numbers={["budget"]}
      fixed={record ? undefined : { prospect_id: prospect }}
    >
      <Field
        name="title"
        label="Objet de la demande"
        value={record?.title}
        min={2}
        max={160}
      />
      <Field
        name="description"
        label="Description du projet"
        value={record?.description}
        type="textarea"
        min={5}
        max={4000}
      />
      <Field
        name="project_type"
        label="Type de travaux"
        value={record?.project_type}
        max={200}
        required={false}
      />
      <Field
        name="city"
        label="Ville du projet"
        value={record?.city}
        max={200}
        required={false}
      />
      <Field
        name="budget"
        label="Budget en euros (facultatif)"
        type="number"
        value={record?.budget || ""}
        min={0}
        max={1000000000}
        required={false}
      />
      <Field
        name="requested_timeline"
        label="Délai souhaité"
        value={record?.requested_timeline}
        max={200}
        required={false}
      />
      <Field
        name="status"
        label="Statut commercial"
        options={statusLabels}
        value={record?.status ?? "nouvelle"}
      />
    </Action>
  );
}
export function PolicyEditor({ policy }: { policy: Settings["policy"] }) {
  return (
    <Action
      path="/api/followup-automation/settings"
      method="PUT"
      title="Enregistrer les délais et plafonds"
      numbers={["delay_hours", "urgent_hours", "max_attempts", "batch_size"]}
      confirm="Appliquer ces paramètres de relance à toute l’entreprise ?"
    >
      <Field
        name="delay_hours"
        label="Délai standard (heures)"
        type="number"
        min={1}
        max={8760}
        value={policy?.delay_hours}
      />
      <Field
        name="urgent_hours"
        label="Délai prioritaire (heures)"
        type="number"
        min={1}
        max={8760}
        value={policy?.urgent_hours}
      />
      <Field
        name="max_attempts"
        label="Maximum de relances par demande"
        type="number"
        min={0}
        max={20}
        value={policy?.max_attempts}
      />
      <Field
        name="batch_size"
        label="Demandes traitées par exécution"
        type="number"
        min={1}
        max={100}
        value={policy?.batch_size}
      />
    </Action>
  );
}

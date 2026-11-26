import { z } from "zod";
import { priorityLabels, statuses, statusLabels } from "@/lib/domain/models";

export const sections = {
  synthese: "Tableau de bord",
  prospects: "Prospects",
  demandes: "Demandes de devis",
  relances: "Relances",
  "rendez-vous": "Rendez-vous",
  activite: "Activité",
  parametres: "Paramètres",
} as const;
export type Section = keyof typeof sections;
export const roleLabels = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Membre",
};
export type Role = keyof typeof roleLabels;
export const labels: Record<string, string> = {
  ...statusLabels,
  ...priorityLabels,
  proposed: "Proposé",
  pending: "En attente",
  confirmed: "Confirmé",
  cancelled: "Annulé",
  error: "En erreur",
  scheduled: "Planifiée",
  prepared: "Préparée",
  sent: "Envoyée",
  manual: "Manuel",
  done: "Réalisé",
  paused: "Suspendue",
  opt_out: "Opposition aux communications",
  human: "Intervention humaine",
  qualification_review: "Qualification à vérifier",
  interested: "Intérêt exprimé",
  information: "Informations demandées",
  appointment: "Rendez-vous demandé",
  refused: "Proposition refusée",
  not_configured: "Relances à configurer",
  contact_preference_required: "Canal de contact à renseigner",
  manual_followup: "Rappel manuel en cours",
  limit: "Plafond atteint",
  delay: "Délai accordé",
  new_request: "Nouvelle demande",
  confirmed_appointment: "Rendez-vous confirmé",
  awaiting_delivery: "En attente de préparation",
  waiting: "Délai en cours",
  delivery_confirmed: "Envoi confirmé",
  evenement: "Action de suivi",
  contact: "Contact enregistré",
  pause: "Suspension",
  resume: "Reprise",
  preference: "Préférence de contact modifiée",
  statut: "Statut commercial modifié",
  qualification: "Qualification par règles",
  demande: "Demande créée",
  relance: "Suivi commercial",
  "rendez-vous": "Rendez-vous",
};
export const label = (value: string) =>
  Object.hasOwn(labels, value) ? labels[value] : value;
export function workspaceUrl(
  view: Section,
  params: Record<string, string | undefined> = {},
) {
  const query = new URLSearchParams({ vue: view });
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key, value);
  return "/espace?" + query;
}
export const dateLabel = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").reverse().join("/")
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(new Date(value));
export const listSchema = z
  .array(
    z.object({
      key: z.string(),
      id: z.uuid(),
      request_id: z.uuid().nullable(),
      title: z.string(),
      detail: z.string(),
      state: z.string(),
      stamp: z.string().nullable(),
      priority: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  )
  .max(26);
export const metricsSchema = z.object({
  prospects: z.int(),
  new: z.int(),
  open: z.int(),
  priority: z.int(),
  won: z.int(),
  lost: z.int(),
  scheduled: z.int(),
  attention: z.int(),
  confirmed: z.int(),
});
export const activitySchema = z
  .array(
    z.object({
      request_id: z.uuid(),
      stamp: z.string(),
      kind: z.string(),
      key: z.string(),
      title: z.string(),
      detail: z.string(),
    }),
  )
  .max(20);
export const policySchema = z.object({
  delay_hours: z.int(),
  urgent_hours: z.int(),
  max_attempts: z.int(),
  batch_size: z.int(),
});
export const settingsSchema = z.object({
  calendar: z.boolean(),
  policy: policySchema.nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const prospectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
  sector: z.string(),
  email: z.string().default(""),
  phone: z.string().default(""),
});
export const requestSchema = z.object({
  id: z.uuid(),
  prospect_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  project_type: z.string().default(""),
  city: z.string().default(""),
  requested_timeline: z.string().default(""),
  budget: z.number().default(0),
  status: z.enum(statuses),
});
export type ClientProspect = z.infer<typeof prospectSchema>;
export type ClientRequest = z.infer<typeof requestSchema>;

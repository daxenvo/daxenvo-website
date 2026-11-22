import { z } from "zod";

const label = z
  .string()
  .trim()
  .min(2, "Saisissez au moins 2 caractères.")
  .max(160);
const id = z.string().min(1).max(100);
export const statuses = [
  "nouvelle",
  "a_qualifier",
  "qualifiee",
  "en_cours",
  "gagnee",
  "perdue",
] as const;
export const statusLabels: Record<(typeof statuses)[number], string> = {
  nouvelle: "Nouvelle",
  a_qualifier: "À qualifier",
  qualifiee: "Qualifiée",
  en_cours: "Devis en cours",
  gagnee: "Gagnée",
  perdue: "Perdue",
};
export const priorityLabels = {
  elevee: "Élevée",
  moyenne: "Moyenne",
  faible: "Faible",
  a_preciser: "À préciser",
} as const;
export const qualificationSchema = z.object({
  priorite: z.enum(["elevee", "moyenne", "faible", "a_preciser"]),
  motif: z.string().max(500),
  actionRecommandee: z.string().max(500),
  informationsManquantes: z.array(z.string().max(100)).max(5),
  analysePar: z.literal("regles"),
  requiresHumanReview: z.boolean(),
});
export const prospectInput = z.object({
  name: label,
  sector: label,
  city: label,
});
export const prospectSchema = prospectInput.extend({
  id,
  createdAt: z.iso.date(),
});
export const requestInput = z.object({
  prospectId: id,
  title: label,
  description: z
    .string()
    .trim()
    .min(5, "Décrivez le projet en 5 caractères minimum.")
    .max(4000),
  typeTravaux: z.string().trim().max(200),
  ville: z.string().trim().max(200),
  budget: z.number().finite().min(0).max(1_000_000_000),
  delai: z.string().trim().max(200),
});
export const requestSchema = requestInput.extend({
  id,
  createdAt: z.iso.date(),
  status: z.enum(statuses),
  qualification: qualificationSchema.nullable(),
});
export const followupInput = z.object({
  requestId: id,
  title: label,
  dueDate: z.iso.date(),
});
export const followupSchema = followupInput.extend({ id, done: z.boolean() });
export const appointmentInput = z.object({
  requestId: id,
  title: label,
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horaire invalide."),
  duration: z.number().int().min(15).max(240),
});
export const appointmentSchema = appointmentInput.extend({ id });
export const demoStateSchema = z
  .object({
    version: z.literal(1),
    prospects: z.array(prospectSchema).max(300),
    requests: z.array(requestSchema).max(300),
    followups: z.array(followupSchema).max(300),
    appointments: z.array(appointmentSchema).max(300),
  })
  .superRefine((data, ctx) => {
    const prospects = new Set(data.prospects.map((p) => p.id));
    const requests = new Set(data.requests.map((r) => r.id));
    if (
      prospects.size !== data.prospects.length ||
      requests.size !== data.requests.length ||
      new Set(data.followups.map((x) => x.id)).size !== data.followups.length ||
      new Set(data.appointments.map((x) => x.id)).size !==
        data.appointments.length ||
      data.requests.some((r) => !prospects.has(r.prospectId)) ||
      [...data.followups, ...data.appointments].some(
        (item) => !requests.has(item.requestId),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Relations de démonstration invalides.",
      });
    }
  });
export type Prospect = z.infer<typeof prospectSchema>;
export type QuoteRequest = z.infer<typeof requestSchema>;
export type Followup = z.infer<typeof followupSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type Qualification = z.infer<typeof qualificationSchema>;
export type DemoState = z.infer<typeof demoStateSchema>;
export type RequestStatus = QuoteRequest["status"];

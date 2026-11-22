import "server-only";
import { creerServiceQualification } from "../../../../j6/service.server.mjs";
import { z } from "zod";
import { qualificationSchema } from "../domain/models";

const input = z
  .object({
    description: z.string().max(4000),
    typeTravaux: z.string().max(200),
    ville: z.string().max(200),
    budget: z.string().max(200),
    delai: z.string().max(200),
  })
  .strict();
// Garde explicite : aucune lecture d'OPENAI_ENABLED et aucun import de l'adaptateur OpenAI.
const analyserRegles = creerServiceQualification({ fournisseur: null });
export async function qualifierExemple(value: unknown) {
  const demande = input.safeParse(value);
  if (!demande.success)
    return {
      ok: false as const,
      error: "La demande est invalide ou trop volumineuse.",
    };
  try {
    // Contexte de démonstration, sans valeur d'authentification ni accès à une base.
    const result = await analyserRegles(demande.data, {
      tenantId: "demonstration-locale-sans-compte",
    });
    return { ok: true as const, result: qualificationSchema.parse(result) };
  } catch {
    return {
      ok: false as const,
      error: "La qualification locale est indisponible. Réessayez.",
    };
  }
}

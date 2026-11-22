"use server";
import { qualifierExemple } from "@/lib/qualification/server";
// Action de démonstration : règles locales seulement, aucune donnée enregistrée côté serveur.
export async function qualifierDemonstration(demande: unknown) {
  return qualifierExemple(demande);
}

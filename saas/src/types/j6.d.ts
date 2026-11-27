declare module "*service.server.mjs" {
  export function creerServiceQualification(options: { fournisseur: null }): (
    demande: {
      description: string;
      typeTravaux?: string;
      ville?: string;
      budget?: string;
      delai?: string;
    },
    contexte: { tenantId: string },
  ) => Promise<{
    priorite: "elevee" | "moyenne" | "faible" | "a_preciser";
    motif: string;
    actionRecommandee: string;
    informationsManquantes: string[];
    signaux: string[];
    analysePar: "regles";
    requiresHumanReview: boolean;
  }>;
}

declare module "*service.server.mjs" {
  export function lireReponseIA(value: unknown): {
    priorite: "elevee" | "moyenne" | "faible" | "a_preciser";
    motif: string; actionRecommandee: string; informationsManquantes: string[]; requiresHumanReview: boolean;
  };
}

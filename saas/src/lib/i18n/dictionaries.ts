export const locales = ["fr"] as const;
export type Locale = (typeof locales)[number];
export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}
export const sections = [
  "tableau-de-bord",
  "prospects",
  "demandes",
  "qualification",
  "suivi",
  "rendez-vous",
  "parametres",
] as const;
export type Section = (typeof sections)[number];
export function isSection(value: string): value is Section {
  return sections.some((section) => section === value);
}
export const fr = {
  app: "Daxenvo",
  tagline: "Chaque opportunité compte.",
  locale: "fr-FR",
  currency: "EUR",
  demo: "Démonstration",
  navigation: {
    "tableau-de-bord": "Tableau de bord",
    prospects: "Prospects",
    demandes: "Demandes de devis",
    qualification: "Qualification",
    suivi: "Suivi commercial",
    "rendez-vous": "Rendez-vous",
    parametres: "Paramètres",
  },
  descriptions: {
    "tableau-de-bord":
      "Vos demandes, vos priorités et vos prochaines actions, au même endroit.",
    prospects: "Faites connaissance avec vos prochaines opportunités.",
    demandes:
      "Gardez une vue claire sur chaque projet, du premier contact au devis.",
    qualification: "Comprenez les besoins et identifiez la prochaine étape.",
    suivi: "La bonne action, au bon moment. Aucun envoi automatique.",
    "rendez-vous": "Préparez les échanges qui font avancer vos projets.",
    parametres: "Un espace de travail qui s’adapte à vos habitudes.",
  },
  common: {
    save: "Enregistrer",
    cancel: "Annuler",
    search: "Rechercher",
    empty: "Aucun résultat",
    newRequest: "Nouvelle demande",
    fictitious: "Données fictives uniquement",
    local: "Sauvegarde locale",
    memory: "Mémoire temporaire",
  },
  status: {
    nouvelle: "Nouvelle",
    a_qualifier: "À qualifier",
    qualifiee: "Qualifiée",
    en_cours: "Devis en cours",
    gagnee: "Gagnée",
    perdue: "Perdue",
  },
  priority: {
    elevee: "Élevée",
    moyenne: "Moyenne",
    faible: "Faible",
    a_preciser: "À préciser",
  },
};
export type Dictionary = typeof fr;
export function getDictionary(locale: Locale): Dictionary {
  void locale;
  return fr;
}
export const money = (value: number) =>
  new Intl.NumberFormat(fr.locale, {
    style: "currency",
    currency: fr.currency,
    maximumFractionDigits: 0,
  }).format(value);
export function dateLabel(date: string, long = false) {
  return new Intl.DateTimeFormat(fr.locale, {
    day: "numeric",
    month: long ? "long" : "short",
    timeZone: "Europe/Paris",
  }).format(new Date(`${date}T12:00:00Z`));
}

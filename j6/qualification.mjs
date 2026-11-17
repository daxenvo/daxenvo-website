/**
 * Daxenvo AI — J6 / qualification locale, déterministe et sans API.
 * Aucune donnée personnelle n'est envoyée à un service tiers.
 * Ce moteur de règles n'est PAS un modèle d'intelligence artificielle.
 *
 * @typedef {'elevee'|'moyenne'|'faible'|'a_preciser'} Priorite
 * @typedef {{description:string,budget?:string,delai?:string,typeTravaux?:string,ville?:string}} Demande
 * @typedef {{version:string,priorite:Priorite,motif:string,actionRecommandee:string,
 *    informationsManquantes:string[],signaux:string[],analysePar:'regles',requiresHumanReview:boolean}} Qualification
 */

const DELAIS = new Map([
  ['dès que possible', 'elevee'],
  ["dans moins d'un mois", 'elevee'],
  ['dans 1 à 3 mois', 'moyenne'],
  ['dans 3 à 6 mois', 'moyenne'],
  ['dans plus de 6 mois', 'faible'],
  ['je ne sais pas encore', 'a_preciser']
]);

const MOTIFS = {
  elevee: 'Projet annoncé comme urgent ou à démarrer sous un mois',
  moyenne: 'Projet annoncé dans un délai de un à six mois',
  faible: 'Projet annoncé dans plus de six mois',
  a_preciser: 'Délai de réalisation non renseigné ou non reconnu'
};

const ACTIONS = {
  elevee: 'Contacter rapidement le prospect pour clarifier ses besoins',
  moyenne: 'Proposer un rendez-vous ou planifier une prise de contact',
  faible: 'Programmer un suivi adapté au calendrier du projet',
  a_preciser: 'Demander au prospect son calendrier prévisionnel'
};

function nettoyer(valeur) {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

function normaliser(valeur) {
  return nettoyer(valeur).normalize('NFKC').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');
}

/**
 * Prend uniquement les informations nécessaires au raisonnement métier.
 * Ne fait aucune promesse sur la solvabilité ni sur la probabilité de signature.
 * @param {Demande} demande
 * @returns {Qualification}
 */
export function qualifierDemande(demande) {
  if (!demande || typeof demande !== 'object' || Array.isArray(demande)) {
    throw new TypeError('Une demande structurée est nécessaire');
  }

  const description = nettoyer(demande.description);
  const budget = nettoyer(demande.budget);
  const delai = nettoyer(demande.delai);
  const typeTravaux = nettoyer(demande.typeTravaux);
  const ville = nettoyer(demande.ville);

  if (description.length > 4000) throw new RangeError('Description trop longue (maximum 4000 caractères)');

  const priorite = DELAIS.get(normaliser(delai)) ?? 'a_preciser';
  const informationsManquantes = [];
  if (!description) informationsManquantes.push('description');
  if (!budget || normaliser(budget) === 'je ne sais pas encore') informationsManquantes.push('budget');
  if (!delai || priorite === 'a_preciser') informationsManquantes.push('delai');
  if (!typeTravaux) informationsManquantes.push('typeTravaux');
  if (!ville) informationsManquantes.push('ville');

  const signaux = [];
  if (typeTravaux) signaux.push('Type de projet fourni');
  if (budget && normaliser(budget) !== 'je ne sais pas encore') signaux.push('Budget déclaré');
  if (delai && priorite !== 'a_preciser') signaux.push('Calendrier déclaré');

  return {
    version: 'j6-regles-v1',
    priorite,
    motif: MOTIFS[priorite],
    actionRecommandee: ACTIONS[priorite],
    informationsManquantes,
    signaux,
    analysePar: 'regles',
    requiresHumanReview: informationsManquantes.length > 0 || priorite === 'a_preciser'
  };
}

/**
 * Vérifie le contrat minimal d'une future réponse IA.
 * Un modèle IA n'est pas connecté à ce stade. Ne jamais interpréter
 * ce contrôle comme une garantie de justesse de l'analyse.
 * @param {unknown} valeur
 */
export function validerSortieIA(valeur) {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false;
  const sortie = /** @type {Record<string, unknown>} */ (valeur);
  return ['elevee', 'moyenne', 'faible', 'a_preciser'].includes(String(sortie.priorite))
    && typeof sortie.motif === 'string' && sortie.motif.length <= 500
    && typeof sortie.actionRecommandee === 'string' && sortie.actionRecommandee.length <= 500
    && Array.isArray(sortie.informationsManquantes)
    && sortie.informationsManquantes.every((x) => typeof x === 'string');
}
